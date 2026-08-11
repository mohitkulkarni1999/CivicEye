import { pool } from '../config/db.js';

export const ROLES = Object.freeze({
  CITIZEN: 'citizen',
  MODERATOR: 'moderator',
  OFFICER: 'officer',
  ADMIN: 'admin',
});

export const ROLE_RANK = {
  citizen: 1,
  moderator: 2,
  officer: 2,
  admin: 3,
};

export const STATUSES = Object.freeze([
  'REPORTED',
  'AI_REVIEW',
  'VERIFIED',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'VERIFIED_RESOLVED',
  'REOPENED',
  'REJECTED',
]);

export const SEVERITIES = Object.freeze(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);

export const statusLabel = (s) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const severityRank = (s) => ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].indexOf(s);

export async function getCategoryById(id) {
  const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getIssueById(id) {
  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getIssueByPublicId(pid) {
  const { rows } = await pool.query('SELECT * FROM issues WHERE public_id = $1', [pid]);
  return rows[0] || null;
}

export async function getDepartmentById(id) {
  const { rows } = await pool.query('SELECT * FROM departments WHERE id = $1', [id]);
  return rows[0] || null;
}
