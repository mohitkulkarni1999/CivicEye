import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { statsService } from '../services/stats.service.js';
import { transitionStatus } from '../services/issue-state.service.js';
import { env } from '../config/env.js';
import { STATUSES, SEVERITIES } from '../utils/constants.js';
import { fetchUploadedImage } from '../middleware/upload.js';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

const importIssuesCsv = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Upload a CSV file (field name: file)');
  const text = req.file.buffer.toString('utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) throw ApiError.badRequest('CSV needs a header row and at least one data row');

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? (r[idx] || '').trim() : '';
  };

  const categoryCache = new Map();
  const findCategory = async (value) => {
    if (!value) return null;
    const key = value.toLowerCase();
    if (categoryCache.has(key)) return categoryCache.get(key);
    const { rows: found } = await pool.query(
      `SELECT id FROM categories WHERE LOWER(name) = $1 OR LOWER(slug) = $1 LIMIT 1`,
      [key],
    );
    const cat = found[0] || null;
    categoryCache.set(key, cat);
    return cat;
  };

  const reporterCache = new Map();
  const findReporter = async (email) => {
    if (!email) return null;
    const key = email.toLowerCase();
    if (reporterCache.has(key)) return reporterCache.get(key);
    const { rows: found } = await pool.query(`SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`, [key]);
    const user = found[0] || null;
    reporterCache.set(key, user);
    return user;
  };

  const imported = [];
  const errors = [];
  const MAX_ROWS = 2000;
  const dataRows = rows.slice(1, 1 + MAX_ROWS);

  await withTransaction(async (client) => {
    for (let r = 0; r < dataRows.length; r++) {
      const raw = dataRows[r];
      const rowNo = r + 2;
      const rec = {
        title: col(raw, 'title'),
        description: col(raw, 'description'),
        category: col(raw, 'category'),
        severity: col(raw, 'severity').toUpperCase(),
        status: col(raw, 'status').toUpperCase(),
        lat: col(raw, 'lat'),
        lng: col(raw, 'lng'),
        address: col(raw, 'address'),
        area: col(raw, 'area'),
        city: col(raw, 'city'),
        landmark: col(raw, 'landmark'),
        created_at: col(raw, 'created_at'),
        reporter_email: col(raw, 'reporter_email'),
      };

      const parsed = z
        .object({
          title: z.string().min(3, 'title must be at least 3 characters').max(200),
          category: z.string().min(2, 'category required'),
          severity: z.enum(SEVERITIES).default('MODERATE'),
          status: z.enum(STATUSES).default('VERIFIED'),
          lat: z.coerce.number().min(-90).max(90),
          lng: z.coerce.number().min(-180).max(180),
        })
        .safeParse(rec);

      if (!parsed.success) {
        errors.push({ row: rowNo, error: parsed.error.issues.map((i) => i.message).join('; ') });
        continue;
      }

      const category = await findCategory(rec.category);
      if (!category) {
        errors.push({ row: rowNo, error: `unknown category "${rec.category}"` });
        continue;
      }

      const reporter = await findReporter(rec.reporter_email);
      const created_at = rec.created_at ? new Date(rec.created_at) : null;
      if (rec.created_at && Number.isNaN(created_at.getTime())) {
        errors.push({ row: rowNo, error: `invalid created_at "${rec.created_at}"` });
        continue;
      }

      const data = parsed.data;
      const { rows: inserted } = await client.query(
        `INSERT INTO issues
           (reporter_id, is_anonymous, category_id, title, description, status, severity,
            lat, lng, address, area, city, landmark, confidence, is_demo, is_hidden,
            reported_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, false, false, $14, $14, $14)
         RETURNING id, public_id`,
        [
          reporter?.id || null,
          !reporter,
          category.id,
          data.title,
          rec.description || '',
          data.status,
          data.severity,
          data.lat,
          data.lng,
          rec.address || '',
          rec.area || '',
          rec.city || '',
          rec.landmark || '',
          created_at || new Date(),
        ],
      );

      await client.query(
        `INSERT INTO issue_status_history (issue_id, from_status, to_status, changed_by, note, created_at)
         VALUES ($1, NULL, $2, NULL, 'Imported from CSV', $3)`,
        [inserted[0].id, data.status, created_at || new Date()],
      );

      imported.push({ row: rowNo, publicId: inserted[0].public_id });
    }
  });

  res.status(201).json({
    imported: imported.length,
    skipped: dataRows.length - imported.length,
    errors: errors.slice(0, 50),
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.is_demo, u.department_id,
            d.name AS department_name, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM issues i WHERE i.reporter_id = u.id)::int AS reports
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      ORDER BY u.created_at DESC`,
  );
  res.json({ users: rows });
});

const updateUser = asyncHandler(async (req, res) => {
  const schema = z.object({
    role: z.enum(['citizen', 'moderator', 'officer', 'admin']).optional(),
    is_active: z.boolean().optional(),
    department_id: z.string().uuid().nullable().optional(),
    password: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid user payload');

  const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!userRes.rows[0]) throw ApiError.notFound('User not found');

  const updates = [];
  const values = [];
  if (parsed.data.role !== undefined) {
    values.push(parsed.data.role);
    updates.push(`role = $${values.length}`);
  }
  if (parsed.data.is_active !== undefined) {
    values.push(parsed.data.is_active);
    updates.push(`is_active = $${values.length}`);
  }
  if (parsed.data.department_id !== undefined) {
    values.push(parsed.data.department_id);
    updates.push(`department_id = $${values.length}`);
  }
  if (parsed.data.password) {
    values.push(await bcrypt.hash(parsed.data.password, 10));
    updates.push(`password_hash = $${values.length}`);
  }
  if (!updates.length) return res.json({ message: 'Nothing to update' });
  values.push(req.params.id);
  await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ message: 'User updated' });
});

const createOfficer = asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().trim().email('A valid email is required').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    department_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid officer payload');

  const { rows: existing } = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = $1`,
    [parsed.data.email.toLowerCase()],
  );
  if (existing[0]) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, department_id, is_active, email_verified_at)
     VALUES ($1, $2, $3, 'officer', $4, $5, now())
     RETURNING id, name, email, role, department_id, is_active, created_at`,
    [
      parsed.data.name.trim(),
      parsed.data.email.toLowerCase(),
      passwordHash,
      parsed.data.department_id || null,
      parsed.data.is_active,
    ],
  );
  res.status(201).json({ officer: rows[0] });
});

const listOfficers = asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.is_demo, u.department_id,
            d.name AS department_name, u.created_at, u.last_login_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.role = 'officer'
      ORDER BY u.created_at DESC`,
  );
  res.json({ officers: rows });
});

const updateOfficer = asyncHandler(async (req, res) => {
  const schema = z.object({
    is_active: z.boolean().optional(),
    department_id: z.string().uuid().nullable().optional(),
    password: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid officer payload');

  const userRes = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'officer'`,
    [req.params.id],
  );
  if (!userRes.rows[0]) throw ApiError.notFound('Officer not found');

  const updates = [];
  const values = [];
  if (parsed.data.is_active !== undefined) {
    values.push(parsed.data.is_active);
    updates.push(`is_active = $${values.length}`);
  }
  if (parsed.data.department_id !== undefined) {
    values.push(parsed.data.department_id);
    updates.push(`department_id = $${values.length}`);
  }
  if (parsed.data.password) {
    values.push(await bcrypt.hash(parsed.data.password, 10));
    updates.push(`password_hash = $${values.length}`);
  }
  if (!updates.length) return res.json({ message: 'Nothing to update' });
  values.push(req.params.id);
  await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ message: 'Officer updated' });
});

const createCategory = asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100),
    slug: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional().or(z.literal('')),
    icon: z.string().max(50).optional().or(z.literal('')),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#64748b'),
    department_id: z.string().uuid().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid category payload');
  try {
    const { rows } = await pool.query(
      `INSERT INTO categories (name, slug, description, icon, color, department_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [parsed.data.name, parsed.data.slug, parsed.data.description || '', parsed.data.icon || '', parsed.data.color, parsed.data.department_id || null],
    );
    res.status(201).json({ category: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw ApiError.conflict('Category slug already exists');
    throw err;
  }
});

const updateCategory = asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    icon: z.string().max(50).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    department_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid category payload');
  const fields = ['name', 'description', 'icon', 'color', 'department_id', 'is_active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (parsed.data[f] !== undefined) {
      values.push(parsed.data[f]);
      updates.push(`${f} = $${values.length}`);
    }
  }
  if (!updates.length) return res.json({ message: 'Nothing to update' });
  values.push(req.params.id);
  await pool.query(`UPDATE categories SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ message: 'Category updated' });
});

const listCategories = asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, d.name AS department_name
       FROM categories c LEFT JOIN departments d ON d.id = c.department_id
      ORDER BY c.name`,
  );
  res.json({ categories: rows });
});

const createDepartment = asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100),
    slug: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional().or(z.literal('')),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#64748b'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid department payload');
  try {
    const { rows } = await pool.query(
      `INSERT INTO departments (name, slug, description, color) VALUES ($1, $2, $3, $4) RETURNING *`,
      [parsed.data.name, parsed.data.slug, parsed.data.description || '', parsed.data.color],
    );
    res.status(201).json({ department: rows[0] });
  } catch (err) {
    if (err.code === '23505') throw ApiError.conflict('Department slug already exists');
    throw err;
  }
});

const updateDepartment = asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid department payload');
  const updates = [];
  const values = [];
  for (const f of ['name', 'description', 'color', 'is_active']) {
    if (parsed.data[f] !== undefined) {
      values.push(parsed.data[f]);
      updates.push(`${f} = $${values.length}`);
    }
  }
  if (!updates.length) return res.json({ message: 'Nothing to update' });
  values.push(req.params.id);
  await pool.query(`UPDATE departments SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ message: 'Department updated' });
});

const listModerationReports = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.reason, m.status, m.resolution_note, m.created_at,
            m.reporter_id IS NULL AS is_ai,
            i.public_id, i.title AS issue_title,
            c.body AS comment_body,
            u.name AS reporter_name
       FROM moderation_reports m
       LEFT JOIN issues i ON i.id = m.issue_id
       LEFT JOIN issue_comments c ON c.id = m.comment_id
       LEFT JOIN users u ON u.id = m.reporter_id
      ORDER BY (m.status = 'open') DESC, (m.reporter_id IS NULL) DESC, m.created_at DESC`,
  );
  res.json({ reports: rows });
});

const resolveModerationReport = asyncHandler(async (req, res) => {
  const schema = z.object({
    status: z.enum(['open', 'reviewed', 'resolved', 'dismissed']),
    resolution_note: z.string().trim().max(500).optional().or(z.literal('')),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid payload');
  const { rows } = await pool.query('SELECT * FROM moderation_reports WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Report not found');
  await pool.query(
    `UPDATE moderation_reports SET status = $1, resolution_note = $2, handled_by = $3 WHERE id = $4`,
    [parsed.data.status, parsed.data.resolution_note || '', req.user.id, req.params.id],
  );
  res.json({ message: 'Report updated' });
});

const hideIssue = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Issue not found');
  const issue = rows[0];
  if (issue.is_hidden) {
    await pool.query('UPDATE issues SET is_hidden = false WHERE id = $1', [issue.id]);
  } else {
    await pool.query('UPDATE issues SET is_hidden = true WHERE id = $1', [issue.id]);
    await transitionStatus({ issue, toStatus: 'REJECTED', changedBy: req.user.id, note: 'Hidden by moderator', force: true });
  }
  res.json({ message: issue.is_hidden ? 'Issue restored' : 'Issue hidden' });
});

const rejectIssue = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Issue not found');
  await transitionStatus({
    issue: rows[0],
    toStatus: 'REJECTED',
    changedBy: req.user.id,
    note: req.body?.note || 'Rejected by moderator',
  });
  res.json({ message: 'Issue rejected' });
});

const getAnalytics = asyncHandler(async (_req, res) => {
  const [stats, categories, departments, areas, trend] = await Promise.all([
    statsService.overview(),
    statsService.byCategory(),
    statsService.byDepartment(),
    statsService.byArea(),
    statsService.trend(30),
  ]);
  res.json({ stats, categories, departments, areas, trend });
});

const getAiConfig = asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(`SELECT value FROM admin_settings WHERE key = 'ai_config'`);
  res.json({ config: { ...(rows[0]?.value || {}), current: env.aiProvider } });
});

const updateAiConfig = asyncHandler(async (req, res) => {
  const schema = z.object({
    provider: z.enum(['heuristic', 'openai', 'gemini']).optional(),
    label: z.string().max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid config');
  const current = await pool.query(`SELECT value FROM admin_settings WHERE key = 'ai_config'`);
  const merged = { ...(current.rows[0]?.value || {}), ...parsed.data };
  await pool.query(
    `INSERT INTO admin_settings (key, value) VALUES ('ai_config', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(merged)],
  );
  res.json({ config: merged });
});

const manageLocation = asyncHandler(async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(200),
    slug: z.string().trim().min(2).max(200).optional(),
    city: z.string().trim().max(100).optional().or(z.literal('')),
    area: z.string().trim().max(100).optional().or(z.literal('')),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius_m: z.number().int().min(50).max(50000).optional().default(1000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid location payload');
  const { rows } = await pool.query(
    `INSERT INTO locations (name, slug, city, area, lat, lng, radius_m)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city,
        area = EXCLUDED.area, lat = EXCLUDED.lat, lng = EXCLUDED.lng, radius_m = EXCLUDED.radius_m
     RETURNING *`,
    [
      parsed.data.name,
      parsed.data.slug || parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      parsed.data.city || '',
      parsed.data.area || '',
      parsed.data.lat,
      parsed.data.lng,
      parsed.data.radius_m,
    ],
  );
  res.json({ location: rows[0] });
});

const listLocations = asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM locations ORDER BY name');
  res.json({ locations: rows });
});

const runSeed = asyncHandler(async (_req, res) => {
  res.status(410).json({ message: 'Demo seeding is disabled' });
});

// Resolved/fixed issues, newest reported first (used by the admin "Resolved" tab).
const listResolvedIssues = asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.public_id, i.title, i.status, i.area, i.city, i.reported_at,
            (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary) AS cover_url,
            (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary) AS cover_thumb,
            (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id AND x.kind = 'after' ORDER BY x.created_at DESC LIMIT 1) AS after_url,
            (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.kind = 'after' ORDER BY x.created_at DESC LIMIT 1) AS after_thumb,
            (SELECT COUNT(*) FROM issue_images x WHERE x.issue_id = i.id AND x.kind = 'after')::int AS after_count
       FROM issues i
      WHERE i.status IN ('RESOLVED', 'VERIFIED_RESOLVED')
        AND i.is_hidden = false
      ORDER BY i.reported_at DESC
      LIMIT 100`,
  );
  res.json({ issues: rows });
});

// Attach a resolution (after) photo to an issue, e.g. the last reported one.
const addResolutionPhoto = asyncHandler(async (req, res) => {
  const schema = z.object({
    imageId: z.string().uuid(),
    note: z.string().trim().max(500).optional().or(z.literal('')),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('A valid imageId is required');

  const { rows } = await pool.query('SELECT id, public_id FROM issues WHERE id = $1', [req.params.id]);
  const issue = rows[0];
  if (!issue) throw ApiError.notFound('Issue not found');

  const upload = await fetchUploadedImage(parsed.data.imageId, req.user.id);
  if (!upload) throw ApiError.badRequest('Image not found or expired');

  await withTransaction(async (client) => {
    const imgRes = await client.query(
      `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash)
       VALUES ($1, $2, $3, $4, 'after', false, $5, $6, $7, $8, $9) RETURNING id`,
      [
        issue.id,
        req.user.id,
        upload.url,
        upload.thumb_url,
        upload.mime,
        upload.width,
        upload.height,
        upload.size_bytes,
        upload.perceptual_hash,
      ],
    );
    await client.query(
      `INSERT INTO issue_evidence (issue_id, evidence_type, image_id, submitted_by, note, status)
       VALUES ($1, 'official', $2, $3, $4, 'accepted')`,
      [issue.id, imgRes.rows[0].id, req.user.id, parsed.data.note || 'Resolution photo uploaded by admin'],
    );
  });

  const imgRes = await pool.query(
    `SELECT id, url, thumb_url, kind, mime FROM issue_images WHERE issue_id = $1 ORDER BY created_at ASC`,
    [issue.id],
  );
  res.status(201).json({ message: 'Resolution photo attached', issueId: issue.id, images: imgRes.rows });
});

export const adminController = {
  listUsers,
  updateUser,
  createOfficer,
  listOfficers,
  updateOfficer,
  createCategory,
  updateCategory,
  listCategories,
  createDepartment,
  updateDepartment,
  listModerationReports,
  resolveModerationReport,
  hideIssue,
  rejectIssue,
  importIssuesCsv,
  getAnalytics,
  getAiConfig,
  updateAiConfig,
  manageLocation,
  listLocations,
  listResolvedIssues,
  addResolutionPhoto,
};
