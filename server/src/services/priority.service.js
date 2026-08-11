import { pool } from '../config/db.js';
import { haversine } from './geo.service.js';

const SEVERITY_SCORES = { LOW: 10, MODERATE: 20, HIGH: 30, CRITICAL: 40 };

/**
 * Explainable civic priority score (0-100).
 * Every factor is recorded so the number is never a mysterious AI figure.
 */
export async function computePriorityScore(issueId, options = {}) {
  const { rows } = await pool.query(
    `SELECT i.*, c.name AS category_name, c.slug AS category_slug
       FROM issues i LEFT JOIN categories c ON c.id = i.category_id
      WHERE i.id = $1`,
    [issueId],
  );
  const issue = rows[0];
  if (!issue) return null;

  const factors = [];

  const base = SEVERITY_SCORES[issue.severity] ?? 20;
  factors.push({ label: `${issue.severity.toLowerCase()} severity`, points: base });

  const { rows: confRows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM issue_confirmations WHERE issue_id = $1',
    [issueId],
  );
  const confirmations = confRows[0]?.n || 0;
  const confPoints = Math.min(25, Math.round(confirmations * 2.5));
  factors.push({
    label: `${confirmations} citizen confirmation${confirmations === 1 ? '' : 's'}`,
    points: confPoints,
  });

  const daysOpen = Math.max(
    0,
    Math.ceil(
      ((issue.resolved_at || new Date()) - issue.reported_at) / (24 * 60 * 60 * 1000),
    ),
  );
  const agePoints = Math.min(20, Math.round(daysOpen * 1.2));
  factors.push({ label: `${daysOpen} day${daysOpen === 1 ? '' : 's'} unresolved`, points: agePoints });

  let safetyPoints = 0;
  if (issue.severity === 'CRITICAL' || issue.severity === 'HIGH') {
    safetyPoints = 10;
    factors.push({ label: 'High safety risk', points: 10 });
  }

  const { rows: recentRows } = await pool.query(
    `SELECT id FROM issues
      WHERE id <> $1
        AND status NOT IN ('REJECTED')
        AND haversine(lat, lng, $2, $3) < 800
        AND created_at > now() - interval '14 days'`,
    [issue.id, issue.lat, issue.lng],
  );
  const recentPoints = Math.min(5, recentRows.length);
  if (recentPoints > 0) {
    factors.push({ label: `${recentRows.length} recent report${recentRows.length === 1 ? '' : 's'} nearby`, points: recentPoints });
  }

  if (issue.status === 'REOPENED' || issue.reopened_at) {
    factors.push({ label: 'Issue was reopened', points: 5 });
  }

  const total = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));

  await pool.query(
    'UPDATE issues SET priority_score = $1, priority_factors = $2 WHERE id = $3',
    [total, JSON.stringify(factors), issue.id],
  );

  return { score: total, factors, daysOpen };
}
