import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../middleware/auth.js';
import { env } from '../config/env.js';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().email('A valid email is required').max(255),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function register(req, res) {
  const { name, email, phone, password } = req.body;

  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1 OR ($2 <> \'\' AND phone = $2)',
    [email.toLowerCase(), phone || ''],
  );
  if (existing.rows[0]) {
    throw ApiError.conflict('An account with this email or phone already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, 'citizen')
     RETURNING id, name, email, phone, role, department_id, avatar_url, created_at`,
    [name.trim(), email.toLowerCase(), phone || null, passwordHash],
  );
  const user = rows[0];
  const token = signToken(user);
  res.status(201).json({ token, user });
}

export async function login(req, res) {
  const { email, password } = req.body;
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, role, department_id, avatar_url, password_hash, is_active
       FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    throw ApiError.unauthorized('Invalid email or password.');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw ApiError.unauthorized('Invalid email or password.');

  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const publicUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    department_id: user.department_id,
    avatar_url: user.avatar_url,
  };
  res.json({ token: signToken(publicUser), user: publicUser });
}

export async function me(req, res) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.avatar_url, u.is_demo,
            u.created_at, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [req.user.id],
  );
  if (!rows[0]) throw ApiError.notFound('User not found');
  res.json({ user: rows[0] });
}

export const listDemoAccounts = asyncHandler(async (_req, res) => {
  if (env.isProd) return res.json({ accounts: [] });
  const { rows } = await pool.query(
    `SELECT email, name, role FROM users WHERE is_demo = true ORDER BY role`,
  );
  res.json({ accounts: rows.map((r) => ({ email: r.email, role: r.role, name: r.name, password: 'demo1234' })) });
});
