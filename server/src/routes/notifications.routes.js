import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { aiService } from '../services/ai/index.js';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, data, is_read, created_at
       FROM notifications WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [req.user.id],
  );
  const unread = rows.filter((r) => !r.is_read).length;
  res.json({ notifications: rows, unread });
}));

router.post('/digest', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT type, title, body FROM notifications
      WHERE user_id = $1 AND is_read = false
      ORDER BY created_at DESC LIMIT 30`,
    [req.user.id],
  );
  const result = await aiService.generateDigest({ items: rows });
  await pool.query(
    `INSERT INTO ai_analysis (user_id, kind, provider, model, result, confidence)
     VALUES ($1, 'digest', $2, NULL, $3, 0)`,
    [req.user.id, result.provider, JSON.stringify(result)],
  );
  res.json(result);
}));

router.patch('/read-all', asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'All notifications marked as read' });
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  res.json({ message: 'Notification marked as read' });
}));

export default router;
