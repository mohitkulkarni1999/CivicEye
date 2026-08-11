import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { statsService } from '../services/stats.service.js';
import { insightService } from '../services/insight.service.js';

const router = Router();

router.get('/stats', asyncHandler(async (_req, res) => {
  res.json({ stats: await statsService.overview() });
}));

router.get('/categories', asyncHandler(async (_req, res) => {
  res.json({ categories: await statsService.byCategory() });
}));

router.get('/departments', asyncHandler(async (_req, res) => {
  res.json({ departments: await statsService.byDepartment() });
}));

router.get('/areas', asyncHandler(async (_req, res) => {
  res.json({ areas: await statsService.byArea() });
}));

router.get('/area-grid', asyncHandler(async (_req, res) => {
  res.json({ grid: await statsService.areaGrid() });
}));

router.get('/longest', asyncHandler(async (req, res) => {
  const n = Math.min(50, Number(req.query.limit) || 10);
  res.json({ issues: await statsService.longestUnresolved(n) });
}));

router.get('/recent-resolved', asyncHandler(async (req, res) => {
  const n = Math.min(50, Number(req.query.limit) || 10);
  res.json({ issues: await statsService.recentlyResolved(n) });
}));

router.get('/trend', asyncHandler(async (req, res) => {
  const days = Math.min(120, Number(req.query.days) || 30);
  res.json({ trend: await statsService.trend(days) });
}));

router.get('/insights', asyncHandler(async (_req, res) => {
  const result = await insightService.generate();
  res.json(result);
}));

router.get('/search', asyncHandler(async (req, res) => {
  const q = z.string().trim().max(120).parse(req.query.q || '');
  if (!q) return res.json({ issues: [] });
  const { rows } = await pool.query(
    `SELECT i.public_id, i.title, i.severity, i.status, i.lat, i.lng, i.area, i.is_demo,
            c.name AS category
       FROM issues i JOIN categories c ON c.id = i.category_id
      WHERE i.is_hidden = false
        AND (i.title ILIKE $1 OR i.description ILIKE $1 OR i.address ILIKE $1
             OR i.area ILIKE $1 OR CAST(i.public_id AS TEXT) = $2 OR c.name ILIKE $1)
      ORDER BY i.created_at DESC LIMIT 50`,
    [`%${q}%`, q],
  );
  res.json({ issues: rows });
}));

export default router;
