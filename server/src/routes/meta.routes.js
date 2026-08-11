import { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/categories', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.slug, c.description, c.icon, c.color, c.is_active,
            d.name AS department_name
       FROM categories c LEFT JOIN departments d ON d.id = c.department_id
      WHERE c.is_active = true ORDER BY c.name ASC`,
  );
  res.json({ categories: rows });
}));

router.get('/departments', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, slug, description, color, is_active FROM departments WHERE is_active = true ORDER BY name ASC',
  );
  res.json({ departments: rows });
}));

export default router;
