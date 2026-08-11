import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES, ROLE_RANK } from '../utils/constants.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized());

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const { rows } = await pool.query(
      `SELECT id, email, name, role, department_id, avatar_url, is_active
         FROM users WHERE id = $1`,
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active) return next(ApiError.unauthorized('Account is disabled'));
    req.user = user;
    req.userRole = user.role;
    return next();
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
}

export function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.has(req.user.role)) return next(ApiError.forbidden());
    return next();
  };
}

export function requireMinRank(minRole) {
  const min = ROLE_RANK[minRole] ?? ROLE_RANK.citizen;
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if ((ROLE_RANK[req.user.role] ?? 0) < min) return next(ApiError.forbidden());
    return next();
  };
}

export const optionalAuth = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    (async () => {
      const { rows } = await pool.query(
        `SELECT id, email, name, role, department_id, avatar_url, is_active
           FROM users WHERE id = $1`,
        [payload.sub],
      );
      if (rows[0]?.is_active) req.user = rows[0];
    })().then(() => next(), () => next());
  } catch {
    return next();
  }
};
