import { pool } from '../config/db.js';
import { STATUSES, statusLabel } from '../utils/constants.js';
import { notify, notifyFollowers } from './notification.service.js';
import { computePriorityScore } from './priority.service.js';

export const STATUS_FLOW = Object.freeze({
  REPORTED: ['AI_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED'],
  AI_REVIEW: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED'],
  VERIFIED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  IN_PROGRESS: ['RESOLVED', 'REOPENED', 'REJECTED'],
  RESOLVED: ['VERIFIED_RESOLVED', 'REOPENED', 'IN_PROGRESS'],
  VERIFIED_RESOLVED: ['REOPENED'],
  REOPENED: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'],
  REJECTED: ['REOPENED'],
});

/**
 * Transition an issue to a new status, always recording history and never
 * silently overwriting. Throws for illegal transitions unless force is used.
 */
export async function transitionStatus({
  issue,
  toStatus,
  changedBy,
  note = '',
  force = false,
}) {
  if (!STATUSES.includes(toStatus)) {
    throw new Error(`Unknown status "${toStatus}"`);
  }
  if (!force && issue.status === toStatus) {
    throw new Error(`Issue is already ${statusLabel(toStatus)}`);
  }
  if (!force && !STATUS_FLOW[issue.status]?.includes(toStatus)) {
    throw new Error(
      `Cannot move issue from ${statusLabel(issue.status)} to ${statusLabel(toStatus)}`,
    );
  }

  const fromStatus = issue.status;
  await pool.query(
    `INSERT INTO issue_status_history (issue_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [issue.id, fromStatus, toStatus, changedBy || null, note],
  );

  const updates = ['status = $2'];
  const params = [issue.id, toStatus];
  if (toStatus === 'RESOLVED' || toStatus === 'VERIFIED_RESOLVED') {
    updates.push('resolved_at = COALESCE(resolved_at, now())');
  }
  if (toStatus === 'REOPENED') {
    updates.push('reopened_at = now()');
  }
  await pool.query(`UPDATE issues SET ${updates.join(', ')} WHERE id = $1`, params);

  await computePriorityScore(issue.id);

  await notifyFollowers({
    issueId: issue.id,
    issueTitle: issue.title,
    type: 'status_change',
    title: `Issue #${issue.public_id} is now ${statusLabel(toStatus)}`,
    body: `"${issue.title}" — ${note || statusLabel(toStatus)}`,
  });

  return { from: fromStatus, to: toStatus };
}

export async function getStatusHistory(issueId) {
  const { rows } = await pool.query(
    `SELECT h.*, u.name AS changed_by_name
       FROM issue_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.issue_id = $1 ORDER BY h.created_at ASC`,
    [issueId],
  );
  return rows;
}
