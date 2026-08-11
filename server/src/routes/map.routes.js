import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

function parseFilters(req) {
  const raw = req.query || {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    minLat: num(raw.minLat),
    maxLat: num(raw.maxLat),
    minLng: num(raw.minLng),
    maxLng: num(raw.maxLng),
    status: typeof raw.status === 'string' ? raw.status : undefined,
    severity: typeof raw.severity === 'string' ? raw.severity : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    unresolved: raw.unresolved === 'true' || raw.unresolved === '1',
    minDate: typeof raw.minDate === 'string' ? raw.minDate : undefined,
  };
}

function buildWhere(q) {
  const where = ['i.is_hidden = false'];
  const params = [];
  if (
    q.minLat !== undefined &&
    q.maxLat !== undefined &&
    q.minLng !== undefined &&
    q.maxLng !== undefined
  ) {
    const p0 = params.length;
    where.push(`i.lat BETWEEN $${p0 + 1} AND $${p0 + 2}`);
    where.push(`i.lng BETWEEN $${p0 + 3} AND $${p0 + 4}`);
    params.push(q.minLat, q.maxLat, q.minLng, q.maxLng);
  }
  if (q.unresolved) {
    where.push(`i.status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')`);
  } else if (q.status && q.status !== 'open') {
    where.push(`i.status = $${params.length + 1}`);
    params.push(q.status);
  } else if (q.status === 'open') {
    where.push(`i.status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')`);
  }
  if (q.severity) {
    where.push(`i.severity = $${params.length + 1}`);
    params.push(q.severity);
  }
  if (q.category) {
    where.push(`c.slug = $${params.length + 1}`);
    params.push(q.category);
  }
  if (q.minDate) {
    where.push(`i.created_at >= $${params.length + 1}`);
    params.push(q.minDate);
  }
  return { where, params };
}

router.get('/issues', asyncHandler(async (req, res) => {
  const q = parseFilters(req);
  const { where, params } = buildWhere(q);
  const { rows } = await pool.query(
    `SELECT i.id, i.public_id, i.title, i.status, i.severity, i.priority_score,
            i.lat, i.lng, i.area, i.is_demo, i.reported_at,
            c.slug AS category_slug, c.name AS category_name,
            (SELECT COUNT(*) FROM issue_confirmations x WHERE x.issue_id = i.id)::int AS confirmations,
            (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary) AS thumb_url
       FROM issues i JOIN categories c ON c.id = i.category_id
      WHERE ${where.join(' AND ')}
      LIMIT 3000`,
    params,
  );
  res.json({ issues: rows });
}));

router.get('/heatmap', asyncHandler(async (req, res) => {
  const q = parseFilters(req);
  const { where, params } = buildWhere(q);
  const weightExpr = q.unresolved ? '1' : '(1 + i.priority_score::float / 100)';
  const { rows } = await pool.query(
    `SELECT i.lat, i.lng, SUM(${weightExpr})::float AS weight, COUNT(*)::int AS count
       FROM issues i JOIN categories c ON c.id = i.category_id
      WHERE ${where.join(' AND ')}
      GROUP BY i.lat, i.lng LIMIT 5000`,
    params,
  );
  res.json({ points: rows });
}));

export default router;
