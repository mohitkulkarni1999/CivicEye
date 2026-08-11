import { z } from 'zod';
import { pool, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { transitionStatus } from '../services/issue-state.service.js';
import { aiService } from '../services/ai/index.js';
import { fetchUploadedImage } from '../middleware/upload.js';
import { notifyReporter, notifyFollowers, notifyEngagedUsers } from '../services/notification.service.js';

const STATUS_SCHEMA = z.object({
  toStatus: z.enum([
    'VERIFIED',
    'ASSIGNED',
    'IN_PROGRESS',
    'RESOLVED',
    'REOPENED',
    'REJECTED',
  ]),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
  afterImageId: z.string().uuid().optional(),
});

const ASSIGN_SCHEMA = z.object({
  departmentId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

function scopeWhere(req, params) {
  if (req.user.role === 'officer' && req.user.department_id) {
    params.push(req.user.department_id);
    return 'i.department_id = $' + params.length;
  }
  return 'TRUE';
}

export const getOfficerIssues = asyncHandler(async (req, res) => {
  const q = req.query;
  const params = [];
  const where = [`i.is_hidden = false`, scopeWhere(req, params)];

  if (q.status) {
    if (q.status === 'open') where.push(`i.status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')`);
    else {
      where.push(`i.status = $${params.length + 1}`);
      params.push(q.status);
    }
  }
  if (q.severity) {
    where.push(`i.severity = $${params.length + 1}`);
    params.push(q.severity);
  }
  if (q.category) {
    where.push(`c.slug = $${params.length + 1}`);
    params.push(q.category);
  }
  if (q.area) {
    where.push(`i.area ILIKE $${params.length + 1}`);
    params.push(`%${q.area}%`);
  }
  if (q.q) {
    where.push(`(i.title ILIKE $${params.length + 1} OR CAST(i.public_id AS TEXT) = $${params.length + 2})`);
    params.push(`%${q.q}%`, q.q);
  }

  const sort =
    q.sort === 'newest' ? 'i.created_at DESC' : 'i.priority_score DESC, i.created_at ASC';

  const { rows } = await pool.query(
    `SELECT i.id, i.public_id, i.title, i.category_id, i.department_id, i.status, i.severity,
            i.priority_score, i.lat, i.lng, i.area, i.reported_at, i.created_at, i.is_demo,
            c.name AS category_name, c.slug AS category_slug, d.name AS department_name,
            EXTRACT(EPOCH FROM (now() - i.reported_at)) / 86400 AS age_days,
            (SELECT COUNT(*) FROM issue_confirmations x WHERE x.issue_id = i.id)::int AS confirmations,
            (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary) AS thumb_url,
            (SELECT a.assigned_to FROM issue_assignments a
              WHERE a.issue_id = i.id AND a.is_current = true ORDER BY a.created_at DESC LIMIT 1) AS assigned_to_id
       FROM issues i
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN departments d ON d.id = i.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${sort}
      LIMIT 200`,
    params,
  );
  res.json({ issues: rows });
});

export const getOfficerStats = asyncHandler(async (req, res) => {
  const params = [];
  const scoped = scopeWhere(req, params);
  const scopedSql = `WHERE is_hidden = false AND ${scoped.replace('i.department_id', 'department_id')}`;

  const base = async (sql) => {
    const { rows } = await pool.query(sql, params);
    return rows[0];
  };

  const [open, critical, assigned, overdue, resolvedMonth, avgTime] = await Promise.all([
    base(`SELECT COUNT(*)::int AS n FROM issues ${scopedSql} AND status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')`),
    base(`SELECT COUNT(*)::int AS n FROM issues ${scopedSql} AND severity = 'CRITICAL' AND status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')`),
    base(`SELECT COUNT(*)::int AS n FROM issues ${scopedSql} AND status = 'ASSIGNED'`),
    base(`SELECT COUNT(*)::int AS n FROM issues ${scopedSql} AND status IN ('ASSIGNED','IN_PROGRESS') AND reported_at < now() - interval '30 days'`),
    base(`SELECT COUNT(*)::int AS n FROM issues ${scopedSql} AND status IN ('RESOLVED','VERIFIED_RESOLVED') AND resolved_at >= date_trunc('month', now())`),
    base(`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - reported_at)) / 86400), 0)::numeric(6,1) AS days
            FROM issues ${scopedSql} AND resolved_at IS NOT NULL`),
  ]);

  const depts = await pool.query('SELECT id, name FROM departments WHERE is_active = true ORDER BY name');
  const officers = await pool.query(
    `SELECT u.id, u.name FROM users u WHERE u.role = 'officer' AND u.is_active = true ORDER BY u.name`,
  );

  res.json({
    stats: {
      openIssues: open.n,
      criticalIssues: critical.n,
      assignedIssues: assigned.n,
      overdueIssues: overdue.n,
      resolvedThisMonth: resolvedMonth.n,
      avgResolutionDays: Number(avgTime.days),
    },
    departments: depts.rows,
    officers: officers.rows,
  });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const parsed = STATUS_SCHEMA.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid status payload', parsed.error.issues);

  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
  const issue = rows[0];
  if (!issue) throw ApiError.notFound('Issue not found');

  if (req.user.role === 'officer' && req.user.department_id && issue.department_id !== req.user.department_id) {
    throw ApiError.forbidden('This issue belongs to another department');
  }

  let verification = null;
  if (parsed.data.toStatus === 'RESOLVED') {
    if (!parsed.data.afterImageId) {
      throw ApiError.badRequest('An after-photo is required to mark an issue as resolved');
    }
    const afterUpload = await fetchUploadedImage(parsed.data.afterImageId, req.user.id);
    if (!afterUpload) throw ApiError.badRequest('After-photo not found or expired');

    const beforeRes = await pool.query(
      `SELECT id, url FROM issue_images WHERE issue_id = $1 AND is_primary = true`,
      [issue.id],
    );
    const before = beforeRes.rows[0];

    verification = before
      ? await aiService.verifyRepair({ beforeUrl: before.url, afterUrl: afterUpload.url })
      : null;

    await withTransaction(async (client) => {
      const imgRes = await client.query(
        `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash)
         VALUES ($1, $2, $3, $4, 'after', false, $5, $6, $7, $8, $9) RETURNING id`,
        [
          issue.id,
          req.user.id,
          afterUpload.url,
          afterUpload.thumb_url,
          afterUpload.mime,
          afterUpload.width,
          afterUpload.height,
          afterUpload.size_bytes,
          afterUpload.perceptual_hash,
        ],
      );
      await client.query(
        `INSERT INTO issue_evidence (issue_id, evidence_type, image_id, submitted_by, note, ai_analysis, status)
         VALUES ($1, 'official', $2, $3, $4, $5, 'accepted')`,
        [issue.id, imgRes.rows[0].id, req.user.id, parsed.data.note || '', JSON.stringify(verification)],
      );
      await client.query(
        `INSERT INTO ai_analysis (issue_id, user_id, kind, input_image_ids, provider, model, result, confidence)
         VALUES ($1, $2, 'repair_verification', $3, $4, $5, $6, $7)`,
        [
          issue.id,
          req.user.id,
          JSON.stringify([before?.id || null, imgRes.rows[0].id]),
          verification?.provider || 'heuristic',
          null,
          JSON.stringify(verification),
          verification?.confidence || 0,
        ],
      );
    });
  }

  const note = parsed.data.note || (parsed.data.toStatus === 'RESOLVED' ? 'Marked resolved by department' : '');
  try {
    await transitionStatus({ issue, toStatus: parsed.data.toStatus, changedBy: req.user.id, note });
  } catch (err) {
    if (/cannot move|already|not a valid|no transition/i.test(err.message)) {
      throw ApiError.badRequest(err.message);
    }
    throw err;
  }

  if (parsed.data.toStatus === 'RESOLVED') {
    if (issue.reporter_id) {
      await notifyReporter({
        issueId: issue.id,
        reporterId: issue.reporter_id,
        type: 'issue_resolved',
        title: `Issue #${issue.public_id} has been resolved`,
        body: `"${issue.title}" was marked resolved. View the before/after photos on the issue page.`,
      });
    }
    await notifyEngagedUsers({
      issueId: issue.id,
      type: 'issue_resolved',
      title: `Issue #${issue.public_id} you supported has been resolved`,
      body: `"${issue.title}" was fixed and is now visible with before/after photos on the issue page.`,
      exceptUserIds: [req.user.id, issue.reporter_id],
    });
  }

  res.json({ message: 'Status updated', verification });
});

export const assignIssue = asyncHandler(async (req, res) => {
  const parsed = ASSIGN_SCHEMA.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid assignment payload', parsed.error.issues);

  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
  const issue = rows[0];
  if (!issue) throw ApiError.notFound('Issue not found');

  let departmentId = parsed.data.departmentId || issue.department_id;
  let assignedTo = parsed.data.assignedTo || null;

  if (assignedTo) {
    const userRes = await pool.query('SELECT id, department_id FROM users WHERE id = $1 AND role = $2', [
      assignedTo,
      'officer',
    ]);
    if (!userRes.rows[0]) throw ApiError.badRequest('Assigned user must be an officer');
    departmentId = departmentId || userRes.rows[0].department_id;
  }
  if (!departmentId) throw ApiError.badRequest('A department is required for assignment');

  await pool.query(
    `UPDATE issue_assignments SET is_current = false WHERE issue_id = $1`,
    [issue.id],
  );
  await pool.query(
    `INSERT INTO issue_assignments (issue_id, department_id, assigned_by, assigned_to, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [issue.id, departmentId, req.user.id, assignedTo, parsed.data.note || ''],
  );
  await pool.query('UPDATE issues SET department_id = $1 WHERE id = $2', [departmentId, issue.id]);

  if (['REPORTED', 'AI_REVIEW', 'VERIFIED', 'REOPENED'].includes(issue.status)) {
    await transitionStatus({
      issue: { ...issue, department_id: departmentId },
      toStatus: 'ASSIGNED',
      changedBy: req.user.id,
      note: `Assigned to department`,
    });
  }

  await notifyReporter({
    issueId: issue.id,
    reporterId: issue.reporter_id,
    type: 'issue_assigned',
    title: `Issue #${issue.public_id} has been assigned`,
    body: `"${issue.title}" was assigned to a department for action.`,
  });

  res.json({ message: 'Issue assigned' });
});

export const addOfficialUpdate = asyncHandler(async (req, res) => {
  const body = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('Update text is required');

  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
  const issue = rows[0];
  if (!issue) throw ApiError.notFound('Issue not found');

  await pool.query(
    `INSERT INTO issue_comments (issue_id, user_id, body, is_official)
     VALUES ($1, $2, $3, true)`,
    [issue.id, req.user.id, body.data.body],
  );

  await notifyFollowers({
    issueId: issue.id,
    issueTitle: issue.title,
    type: 'official_update',
    title: `Official update on issue #${issue.public_id}`,
    body: body.data.body.slice(0, 160),
  });

  res.status(201).json({ message: 'Official update posted' });
});
