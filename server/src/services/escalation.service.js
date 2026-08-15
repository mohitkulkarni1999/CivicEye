import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { logAudit } from './audit.service.js';
import { notifyReporter, notifyFollowers } from './notification.service.js';
import { resolveRepresentativeForPoint, pickRepresentative } from './representative.service.js';
import { generateXPost } from './post-generator.service.js';

/**
 * Issue escalation lifecycle.
 *
 *   PENDING  — representative identified; post text not ready yet
 *              (e.g. X account not yet admin-verified)
 *   READY    — post text generated, waiting for admin/officer approval
 *   APPROVED — approved; citizen/admin can share via x.com intent (manual mode)
 *   PUBLISHED— publicly posted to X (manual; external_post_url recorded)
 *   REJECTED — rejected by admin/officer
 *   FAILED   — generation/other failure (retryable)
 *
 * Publishing is manual-only for now (no X API credentials required). The
 * `postType` column keeps one 'report' escalation and one 'resolution'
 * escalation per issue.
 */

export const ESCALATION_STATUSES = Object.freeze([
  'PENDING',
  'READY',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'FAILED',
]);

export const ESCALATION_FLOW = Object.freeze({
  PENDING: ['READY', 'FAILED'],
  READY: ['APPROVED', 'REJECTED', 'FAILED'],
  APPROVED: ['PUBLISHED', 'REJECTED', 'READY'],
  FAILED: ['READY'],
  PUBLISHED: [],
  REJECTED: [],
});

export async function getEscalationById(id) {
  const { rows } = await pool.query(
    `SELECT e.*, i.public_id, i.title, i.area, i.city, i.lat, i.lng, i.reporter_id, i.department_id,
            r.name AS representative_name, r.official_x_username AS representative_x_username,
            r.x_verified_by_admin AS representative_x_verified
       FROM issue_escalations e
       LEFT JOIN issues i ON i.id = e.issue_id
       LEFT JOIN representatives r ON r.id = e.representative_id
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function getEscalationForIssue(issueId, postType = 'report') {
  if (!issueId) return null;
  const { rows } = await pool.query(
    `SELECT e.*, r.official_x_username AS representative_x_username,
            r.name AS representative_name, r.x_verified_by_admin AS representative_x_verified
       FROM issue_escalations e
       LEFT JOIN representatives r ON r.id = e.representative_id
      WHERE e.issue_id = $1 AND e.post_type = $2`,
    [issueId, postType],
  );
  return rows[0] || null;
}

export async function listEscalations({ status = null, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push(`e.status = $${params.length + 1}`);
    params.push(status);
  }
  const { rows } = await pool.query(
    `SELECT e.*, i.public_id, i.title, i.area, i.city, i.status AS issue_status,
            r.name AS representative_name, r.official_x_username AS representative_x_username,
            r.x_verified_by_admin AS representative_x_verified
       FROM issue_escalations e
       LEFT JOIN issues i ON i.id = e.issue_id
       LEFT JOIN representatives r ON r.id = e.representative_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE e.status WHEN 'READY' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'APPROVED' THEN 2
                      WHEN 'FAILED' THEN 3 WHEN 'PUBLISHED' THEN 4 ELSE 5 END,
        e.updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows;
}

async function transitionTo(escalation, toStatus, { actorId = null, details = {} }) {
  const allowed = ESCALATION_FLOW[escalation.status] || [];
  if (!allowed.includes(toStatus)) {
    throw new Error(`Cannot move escalation from ${escalation.status} to ${toStatus}`);
  }
  const { rows } = await pool.query(
    `UPDATE issue_escalations SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [toStatus, escalation.id],
  );
  await logAudit({
    actorId,
    action: `escalation.${toStatus.toLowerCase()}`,
    entityType: 'issue_escalation',
    entityId: escalation.id,
    details: { from: escalation.status, to: toStatus, ...details },
  });
  return rows[0];
}

/**
 * Ensure a 'report' escalation exists for an issue and generate its post text.
 * Non-fatal: resolves the representative, best-effort writes, never throws.
 * Pass `resolved` (from resolveRepresentativeForPoint) to skip re-resolution.
 */
export async function maybeCreateReportEscalation({ issue, category, postType = 'report', resolved = null }) {
  try {
    if (!resolved) {
      resolved = await resolveRepresentativeForPoint(issue.lat, issue.lng);
    }

    // Persist the representative link even if we cannot escalate yet.
    if (resolved.matched && resolved.representative) {
      await pool.query('UPDATE issues SET representative_id = $1 WHERE id = $2', [
        resolved.representative.id,
        issue.id,
      ]);
    }

    const existing = await getEscalationForIssue(issue.id, postType);
    if (existing) return existing;

    if (!resolved.matched || !resolved.representative) {
      return null; // nothing to escalate — ward/reps not available yet
    }

    const { rows } = await pool.query(
      `INSERT INTO issue_escalations (issue_id, representative_id, platform, status, post_type, generated_text)
       VALUES ($1, $2, 'x', $3, $4, $5)
       ON CONFLICT (issue_id, post_type) DO NOTHING
       RETURNING *`,
      [issue.id, resolved.representative.id, 'PENDING', postType, ''],
    );
    if (!rows[0]) return getEscalationForIssue(issue.id, postType);

    const escalation = rows[0];
    await logAudit({
      action: 'escalation.created',
      entityType: 'issue_escalation',
      entityId: escalation.id,
      details: { issueId: issue.id, publicId: issue.public_id, reason: resolved.reason },
    });

    if (resolved.canEscalate) {
      const generated = generateXPost({ issue, category, ward: resolved.ward, representative: resolved.representative, postType });
      await pool.query(
        `UPDATE issue_escalations SET status = 'READY', generated_text = $1 WHERE id = $2`,
        [generated.text, escalation.id],
      );
      await logAudit({
        action: 'escalation.ready',
        entityType: 'issue_escalation',
        entityId: escalation.id,
        details: { publicId: issue.public_id, charCount: generated.charCount },
      });
    }

    return getEscalationForIssue(issue.id, postType);
  } catch (err) {
    logger.warn(`Escalation setup failed for issue ${issue?.id}:`, err.message);
    return null;
  }
}

/**
 * Draft a 'resolution' escalation once an issue is resolved — only when the
 * report escalation was actually published to X. Non-fatal.
 */
export async function maybeCreateResolutionEscalation({ issue, category, updatedBy }) {
  try {
    if (!['RESOLVED', 'VERIFIED_RESOLVED'].includes(issue.status)) return null;
    const reportEsc = await getEscalationForIssue(issue.id, 'report');
    if (!reportEsc || reportEsc.status !== 'PUBLISHED') return null;

    const existing = await getEscalationForIssue(issue.id, 'resolution');
    if (existing) return existing;

    const representative = reportEsc.representative_id
      ? await pool.query('SELECT * FROM representatives WHERE id = $1', [reportEsc.representative_id]).then((r) => r.rows[0] || null)
      : null;

    const generated = generateXPost({
      issue,
      category,
      ward: { ward_number: issue.ward_no },
      representative: representative ? pickRepresentative(representative) : null,
      postType: 'resolution',
      resolution: { updatedBy },
    });

    const { rows } = await pool.query(
      `INSERT INTO issue_escalations (issue_id, representative_id, platform, status, post_type, generated_text)
       VALUES ($1, $2, 'x', 'READY', 'resolution', $3)
       ON CONFLICT (issue_id, post_type) DO NOTHING
       RETURNING *`,
      [issue.id, reportEsc.representative_id, generated.text],
    );
    if (rows[0]) {
      await logAudit({
        action: 'escalation.resolution_drafted',
        entityType: 'issue_escalation',
        entityId: rows[0].id,
        details: { publicId: issue.public_id },
      });
      return rows[0];
    }
    return getEscalationForIssue(issue.id, 'resolution');
  } catch (err) {
    logger.warn(`Resolution escalation failed for issue ${issue?.id}:`, err.message);
    return null;
  }
}

export async function approveEscalation(id, actorId) {
  const escalation = await getEscalationById(id);
  if (!escalation) return null;
  if (!['PENDING', 'READY', 'FAILED'].includes(escalation.status)) {
    throw new Error(`Escalation cannot be approved from ${escalation.status}`);
  }
  const { rows } = await pool.query(
    `UPDATE issue_escalations
        SET status = 'APPROVED', approved_by = $1, rejected_by = NULL, updated_at = now()
      WHERE id = $2
      RETURNING *`,
    [actorId, id],
  );
  await logAudit({
    actorId,
    action: 'escalation.approved',
    entityType: 'issue_escalation',
    entityId: id,
    details: { publicId: escalation.public_id, postType: escalation.post_type },
  });
  if (escalation.reporter_id) {
    await notifyReporter({
      issueId: escalation.issue_id,
      reporterId: escalation.reporter_id,
      type: 'issue_escalated',
      title: `Issue #${escalation.public_id} is approved for public escalation`,
      body: 'Your report has been approved to be shared publicly on X. You can post it from the issue page.',
    });
  }
  return rows[0];
}

export async function rejectEscalation(id, actorId, reason = '') {
  const escalation = await getEscalationById(id);
  if (!escalation) return null;
  if (['PUBLISHED', 'REJECTED'].includes(escalation.status)) {
    throw new Error(`Escalation cannot be rejected from ${escalation.status}`);
  }
  const { rows } = await pool.query(
    `UPDATE issue_escalations
        SET status = 'REJECTED', rejected_by = $1, failure_reason = $2, updated_at = now()
      WHERE id = $3
      RETURNING *`,
    [actorId, reason, id],
  );
  await logAudit({
    actorId,
    action: 'escalation.rejected',
    entityType: 'issue_escalation',
    entityId: id,
    details: { publicId: escalation.public_id, reason },
  });
  return rows[0];
}

export async function markEscalationPublished(id, actorId, { postUrl = '', postId = '' }) {
  const escalation = await getEscalationById(id);
  if (!escalation) return null;
  if (escalation.status !== 'APPROVED') {
    throw new Error(`Only an approved escalation can be marked published (current: ${escalation.status})`);
  }
  const { rows } = await pool.query(
    `UPDATE issue_escalations
        SET status = 'PUBLISHED', external_post_url = $1, external_post_id = $2,
            published_at = now(), updated_at = now()
      WHERE id = $3
      RETURNING *`,
    [postUrl, postId, id],
  );
  await logAudit({
    actorId,
    action: 'escalation.published',
    entityType: 'issue_escalation',
    entityId: id,
    details: { publicId: escalation.public_id, postUrl },
  });
  await notifyFollowers({
    issueId: escalation.issue_id,
    issueTitle: escalation.title,
    type: 'issue_escalated_public',
    title: `Issue #${escalation.public_id} was escalated publicly`,
    body: 'This issue has been shared publicly on X, tagging the elected representative.',
  });
  return rows[0];
}

export async function updateEscalationText(id, text, { actorId = null } = {}) {
  const escalation = await getEscalationById(id);
  if (!escalation) return null;
  if (['PUBLISHED', 'REJECTED'].includes(escalation.status)) {
    throw new Error(`Published or rejected escalations cannot be edited`);
  }
  const { rows } = await pool.query(
    `UPDATE issue_escalations SET generated_text = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [text, id],
  );
  await logAudit({
    actorId,
    action: 'escalation.text_updated',
    entityType: 'issue_escalation',
    entityId: id,
    details: { publicId: escalation.public_id, charCount: (text || '').length },
  });
  return rows[0];
}

export async function retryEscalation(id, actorId) {
  const escalation = await getEscalationById(id);
  if (!escalation) return null;
  if (escalation.status !== 'FAILED') {
    throw new Error(`Only a failed escalation can be retried (current: ${escalation.status})`);
  }
  const { rows } = await pool.query(
    `UPDATE issue_escalations
        SET status = 'PENDING', failure_reason = '', retry_count = retry_count + 1, updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  await logAudit({
    actorId,
    action: 'escalation.retried',
    entityType: 'issue_escalation',
    entityId: id,
    details: { publicId: escalation.public_id },
  });
  return rows[0];
}

/** Public-safe escalation shape for the issue page. */
export function pickEscalation(e) {
  if (!e) return null;
  return {
    id: e.id,
    status: e.status,
    post_type: e.post_type,
    generated_text: e.generated_text,
    external_post_url: e.external_post_url,
    published_at: e.published_at,
    approved_by: e.approved_by,
    failure_reason: e.failure_reason,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}
