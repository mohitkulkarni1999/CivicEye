import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';

/**
 * Notification architecture.
 * Currently delivers in-app notifications only; email/push channels can be
 * enabled later without changing call sites (see CHANNELS below).
 */
const CHANNELS = ['inapp']; // future: 'email', 'push'

export async function notify({ userId, type, title, body = '', data = {} }) {
  if (!userId) return;
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, title, body, JSON.stringify(data)],
    );
    if (CHANNELS.includes('email')) {
      // Email channel not configured yet.
      logger.debug('email channel not configured, skipping');
    }
  } catch (err) {
    logger.error('Failed to create notification', err.message);
  }
}

/**
 * Notify everyone following an issue.
 */
export async function notifyFollowers({ issueId, issueTitle, type, title, body, data = {}, exceptUserId = null }) {
  const { rows } = await pool.query(
    `SELECT user_id FROM issue_followers WHERE issue_id = $1`,
    [issueId],
  );
  for (const row of rows) {
    if (row.user_id === exceptUserId) continue;
    await notify({
      userId: row.user_id,
      type,
      title,
      body: body || title,
      data: { issueId, issueTitle, ...data },
    });
  }
}

export async function notifyReporter({ issueId, reporterId, type, title, body, data = {}, exceptUserId = null }) {
  if (!reporterId || reporterId === exceptUserId) return;
  await notify({
    userId: reporterId,
    type,
    title,
    body: body || title,
    data: { issueId, ...data },
  });
}

/**
 * Notify everyone who engaged with an issue (confirmers + upvoters) the same
 * way followers are notified. Deduplicated; the acting user is always skipped.
 * Followers are intentionally NOT included here because they already receive
 * status-change notifications from transitionStatus.
 */
export async function notifyEngagedUsers({ issueId, type, title, body, data = {}, exceptUserIds = [] }) {
  const except = new Set([...(Array.isArray(exceptUserIds) ? exceptUserIds : [exceptUserIds])].filter(Boolean));
  const { rows } = await pool.query(
    `SELECT user_id FROM issue_confirmations WHERE issue_id = $1 AND user_id IS NOT NULL
     UNION
     SELECT user_id FROM issue_votes WHERE issue_id = $1 AND user_id IS NOT NULL`,
    [issueId],
  );
  const seen = new Set();
  for (const row of rows) {
    if (except.has(row.user_id) || seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    await notify({
      userId: row.user_id,
      type,
      title,
      body: body || title,
      data: { issueId, ...data },
    });
  }
}
