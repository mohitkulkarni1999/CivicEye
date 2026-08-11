import { z } from 'zod';
import { pool, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { SEVERITIES } from '../utils/constants.js';
import { reverseGeocode, haversine } from '../services/geo.service.js';
import { computePriorityScore } from '../services/priority.service.js';
import { DuplicateDetector } from '../services/duplicate.service.js';
import { findLocality } from '../services/locality.service.js';
import { transitionStatus, getStatusHistory } from '../services/issue-state.service.js';
import { notify, notifyFollowers, notifyReporter } from '../services/notification.service.js';
import { computeDHash, fetchUploadedImage } from '../middleware/upload.js';
import { aiService } from '../services/ai/index.js';
import { logger } from '../utils/logger.js';

async function autoModerate({ issueId, commentId, userId, text, context }) {
  if (!text) return;
  try {
    const result = await aiService.moderateText({ text, context });
    if (result.flagged) {
      await pool.query(
        `INSERT INTO moderation_reports (issue_id, comment_id, reporter_id, reason)
         VALUES ($1, $2, NULL, $3)`,
        [
          issueId,
          commentId,
          `AI flagged (score ${result.score.toFixed(2)}): ${result.reason}`,
        ],
      );
      await pool.query(
        `INSERT INTO ai_analysis (user_id, kind, provider, model, result, confidence)
         VALUES ($1, 'moderation', $2, NULL, $3, $4)`,
        [userId, result.provider, JSON.stringify(result), result.score],
      );
    }
  } catch (err) {
    logger.warn('Auto-moderation failed', err.message);
  }
}

export const createIssueSchema = z.object({
  categoryId: z.string().uuid('Valid category is required'),
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(5000).optional().or(z.literal('')),
  severity: z.enum(SEVERITIES).default('MODERATE'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(500).optional().or(z.literal('')),
  area: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(200).optional().or(z.literal('')),
  landmark: z.string().trim().max(300).optional().or(z.literal('')),
  isAnonymous: z.boolean().default(false),
  imageIds: z.array(z.string().uuid()).max(8).default([]),
  aiAnalysisId: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(2000),
});

export const evidenceSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

async function loadIssue(identifier) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(identifier),
  );
  if (isUuid) {
    const byId = await pool.query('SELECT * FROM issues WHERE id = $1', [identifier]);
    if (byId.rows[0]) return byId.rows[0];
  }
  const num = Number(identifier);
  if (Number.isFinite(num)) {
    const byPid = await pool.query('SELECT * FROM issues WHERE public_id = $1', [num]);
    if (byPid.rows[0]) return byPid.rows[0];
  }
  return null;
}

async function attachImages(issueId, uploadIds, uploaderId) {
  if (!uploadIds.length) return;
  const { rows } = await pool.query(
    `SELECT * FROM uploads WHERE id = ANY($1) AND expires_at > now()`,
    [uploadIds],
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = uploadIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw ApiError.badRequest(`Some uploaded images have expired: ${missing.join(', ')}`);
  }
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    const mime = u.mime || '';
    const isMedia = mime.startsWith('video/') || mime.startsWith('audio/');
    const kind = !isMedia ? (i === 0 ? 'before' : 'evidence') : mime.startsWith('video/') ? 'video' : 'audio';
    await pool.query(
      `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash, original_url, original_mime, media_duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        issueId,
        uploaderId,
        u.url,
        u.thumb_url,
        kind,
        !isMedia && i === 0,
        mime,
        u.width,
        u.height,
        u.size_bytes,
        u.perceptual_hash,
        u.original_url || '',
        u.original_mime || '',
        u.media_duration || 0,
      ],
    );
  }
}

export const listIssues = asyncHandler(async (req, res) => {
  const raw = req.query || {};
  const num = (v, d, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(max, Math.max(min, n));
  };
  const f = {
    status: typeof raw.status === 'string' ? raw.status : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    severity: typeof raw.severity === 'string' ? raw.severity : undefined,
    area: typeof raw.area === 'string' ? raw.area : undefined,
    q: typeof raw.q === 'string' ? raw.q : undefined,
    lat: raw.lat !== undefined ? num(raw.lat, undefined, -90, 90) : undefined,
    lng: raw.lng !== undefined ? num(raw.lng, undefined, -180, 180) : undefined,
    radius: raw.radius !== undefined ? num(raw.radius, undefined, 50, 20000) : undefined,
    sort: ['newest', 'priority', 'confirmations', 'oldest'].includes(raw.sort) ? raw.sort : 'newest',
    page: num(raw.page, 1, 1, 10000),
    limit: num(raw.limit, 20, 1, 100),
    includeDemo: raw.includeDemo === 'false' ? false : undefined,
  };
  const where = ['i.is_hidden = false'];
  const params = [];
  const add = (cond) => where.push(cond);

  if (f.status) {
    if (f.status === 'open') {
      add(`i.status NOT IN ('RESOLVED','VERIFIED_RESOLVED','REJECTED')`);
    } else if (f.status === 'resolved') {
      add(`i.status IN ('RESOLVED','VERIFIED_RESOLVED')`);
    } else {
      add(`i.status = $${params.length + 1}`);
      params.push(f.status);
    }
  }
  if (f.category) {
    add(`c.slug = $${params.length + 1}`);
    params.push(f.category);
  }
  if (f.severity) {
    add(`i.severity = $${params.length + 1}`);
    params.push(f.severity);
  }
  if (f.area) {
    add(`i.area ILIKE $${params.length + 1}`);
    params.push(`%${f.area}%`);
  }
  if (f.q) {
    add(`(i.title ILIKE $${params.length + 1} OR i.description ILIKE $${params.length + 2} OR i.address ILIKE $${params.length + 3} OR i.area ILIKE $${params.length + 4} OR CAST(i.public_id AS TEXT) = $${params.length + 5})`);
    const term = `%${f.q}%`;
    params.push(term, term, term, term, f.q);
  }
  if (f.lat !== undefined && f.lng !== undefined && f.radius) {
    add(`haversine(i.lat, i.lng, $${params.length + 1}, $${params.length + 2}) <= $${params.length + 3}`);
    params.push(f.lat, f.lng, f.radius);
  }
  if (f.includeDemo === false) {
    add('i.is_demo = false');
  }

  const orderBy = {
    newest: 'i.created_at DESC',
    oldest: 'i.created_at ASC',
    priority: 'i.priority_score DESC',
    confirmations: '(SELECT COUNT(*) FROM issue_confirmations x WHERE x.issue_id = i.id) DESC',
    resolved: 'COALESCE(i.resolved_at, i.created_at) DESC',
  }[f.sort || 'newest'];

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM issues i JOIN categories c ON c.id = i.category_id WHERE ${where.join(' AND ')}`,
    params,
  );
  const total = countRes.rows[0].n;

  const offset = (f.page - 1) * f.limit;
  const { rows } = await pool.query(
    `SELECT i.id, i.public_id, i.title, i.status, i.severity, i.priority_score,
            i.lat, i.lng, i.area, i.city, i.address, i.is_demo, i.created_at, i.reported_at,
            i.confidence, c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
            d.name AS department_name,
            (SELECT COUNT(*) FROM issue_confirmations x WHERE x.issue_id = i.id)::int AS confirmations,
            (SELECT COUNT(*) FROM issue_votes v WHERE v.issue_id = i.id AND v.direction = 'up')::int AS upvotes,
            (SELECT COUNT(*) FROM issue_comments co WHERE co.issue_id = i.id AND co.is_hidden = false)::int AS comments,
            COALESCE(
              (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary LIMIT 1),
              (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id ORDER BY x.created_at ASC LIMIT 1)
            ) AS cover_url,
            COALESCE(
              (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary LIMIT 1),
              (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id ORDER BY x.created_at ASC LIMIT 1)
            ) AS cover_thumb
       FROM issues i
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN departments d ON d.id = i.department_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.limit, offset],
  );

  res.json({ issues: rows, total, page: f.page, limit: f.limit });
});

export const getIssue = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  if (issue.is_hidden && req.user?.role !== 'admin' && req.user?.role !== 'moderator') {
    throw ApiError.notFound('Issue not found');
  }

  const [catRes, deptRes, imgRes, hist, confRes, voteRes, commentRes, evidenceRes, aiRes, reporterRes] =
    await Promise.all([
      pool.query('SELECT * FROM categories WHERE id = $1', [issue.category_id]),
      pool.query('SELECT * FROM departments WHERE id = $1', [issue.department_id]),
      pool.query(
        `SELECT id, url, thumb_url, kind, is_primary, mime, original_url, original_mime, media_duration
           FROM issue_images WHERE issue_id = $1 ORDER BY created_at ASC`,
        [issue.id],
      ),
      getStatusHistory(issue.id),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM issue_confirmations WHERE issue_id = $1`,
        [issue.id],
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE direction='up')::int AS up,
                COUNT(*) FILTER (WHERE direction='down')::int AS down
           FROM issue_votes WHERE issue_id = $1`,
        [issue.id],
      ),
      pool.query(
        `SELECT c.id, c.body, c.is_official, c.created_at, c.user_id,
                u.name AS user_name, u.role AS user_role,
                u.is_demo, c.is_hidden
           FROM issue_comments c LEFT JOIN users u ON u.id = c.user_id
          WHERE c.issue_id = $1 ORDER BY c.created_at ASC`,
        [issue.id],
      ),
      pool.query(
        `SELECT e.id, e.evidence_type, e.note, e.ai_analysis, e.status, e.created_at,
                i.url, i.thumb_url, u.name AS submitted_by_name
           FROM issue_evidence e
           LEFT JOIN issue_images i ON i.id = e.image_id
           LEFT JOIN users u ON u.id = e.submitted_by
          WHERE e.issue_id = $1 ORDER BY e.created_at ASC`,
        [issue.id],
      ),
      pool.query(
        `SELECT id, kind, provider, model, result, confidence, created_at
           FROM ai_analysis WHERE issue_id = $1 ORDER BY created_at ASC`,
        [issue.id],
      ),
      pool.query(
        `SELECT id, name, email FROM users WHERE id = $1`,
        [issue.reporter_id],
      ),
    ]);

  const comments = commentRes.rows.map((c) => ({
    ...c,
    isOwn: req.user?.id === c.user_id,
    canDelete: req.user && (req.user.id === c.user_id || ['admin', 'moderator'].includes(req.user.role)),
  }));

  let confirmedByMe = false;
  let upvotedByMe = false;
  let followingByMe = false;
  if (req.user) {
    const [cf, vf, ff] = await Promise.all([
      pool.query('SELECT 1 FROM issue_confirmations WHERE issue_id = $1 AND user_id = $2', [issue.id, req.user.id]),
      pool.query('SELECT 1 FROM issue_votes WHERE issue_id = $1 AND user_id = $2', [issue.id, req.user.id]),
      pool.query('SELECT 1 FROM issue_followers WHERE issue_id = $1 AND user_id = $2', [issue.id, req.user.id]),
    ]);
    confirmedByMe = !!cf.rows[0];
    upvotedByMe = !!vf.rows[0];
    followingByMe = !!ff.rows[0];
  }

  const daysOpen = Math.max(
    0,
    Math.ceil(((issue.resolved_at || new Date()) - issue.reported_at) / 86400000),
  );

  res.json({
    issue: {
      ...issue,
      category: catRes.rows[0] || null,
      department: deptRes.rows[0] || null,
      reporter: issue.is_anonymous ? null : reporterRes.rows[0] || null,
      images: imgRes.rows,
      statusHistory: hist,
      confirmations: confRes.rows[0].n,
      votes: voteRes.rows[0],
      comments,
      evidence: evidenceRes.rows,
      aiAnalyses: aiRes.rows,
      daysOpen,
      confirmedByMe,
      upvotedByMe,
      followingByMe,
    },
  });
});

export const createIssue = asyncHandler(async (req, res) => {
  const b = req.body;
  const userId = req.user?.id ?? null;
  const catRes = await pool.query('SELECT * FROM categories WHERE id = $1 AND is_active = true', [
    b.categoryId,
  ]);
  if (!catRes.rows[0]) throw ApiError.badRequest('Invalid or inactive category');

  let aiAnalysis = null;
  if (b.aiAnalysisId) {
    const aRes = await pool.query(
      'SELECT * FROM ai_analysis WHERE id = $1 AND (user_id = $2 OR ($2 IS NULL AND user_id IS NULL))',
      [b.aiAnalysisId, userId],
    );
    aiAnalysis = aRes.rows[0] || null;
    if (!aiAnalysis) throw ApiError.badRequest('AI analysis reference not found');
  }

  let address = b.address || '';
  let area = b.area || '';
  let city = b.city || '';
  if (!address) {
    const geo = await reverseGeocode(b.lat, b.lng);
    address = geo.address;
    area = area || geo.area;
    city = city || geo.city;
  }

  const locality = await findLocality(b.lat, b.lng);
  const localityId = locality?.id ?? b.localityId ?? null;

  const issue = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO issues
        (reporter_id, is_anonymous, category_id, title, description, status, severity,
         lat, lng, address, area, city, landmark, confidence, is_demo,
         locality_id, locality_type, ward_no, officer_name, officer_role, officer_phone, officer_party)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false,
               $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [
        userId,
        !userId || b.isAnonymous,
        b.categoryId,
        b.title,
        b.description || '',
        aiAnalysis?.result?.relevant === false ? 'AI_REVIEW' : 'VERIFIED',
        b.severity,
        b.lat,
        b.lng,
        address,
        area,
        city,
        b.landmark || '',
        b.confidence ?? aiAnalysis?.confidence ?? 0,
        localityId,
        locality?.type ?? '',
        locality?.ward_no ?? '',
        locality?.officer_name ?? '',
        locality?.officer_role ?? '',
        locality?.officer_phone ?? '',
        locality?.officer_party ?? '',
      ],
    );
    const created = rows[0];

    await client.query(
      `INSERT INTO issue_status_history (issue_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, $2, $3, $4)`,
      [created.id, created.status, userId, aiAnalysis ? 'Auto-verified by AI analysis' : 'Reported by citizen'],
    );

    if (aiAnalysis) {
      await client.query('UPDATE ai_analysis SET issue_id = $1 WHERE id = $2', [created.id, aiAnalysis.id]);
    }
    return created;
  });

  await attachImages(issue.id, b.imageIds, userId);
  await computePriorityScore(issue.id);

  const { rows: imgHashes } = await pool.query(
    `SELECT perceptual_hash FROM issue_images WHERE issue_id = $1 AND perceptual_hash IS NOT NULL`,
    [issue.id],
  );
  const dupCheck = await DuplicateDetector.check({
    lat: issue.lat,
    lng: issue.lng,
    categoryId: issue.category_id,
    perceptualHashes: imgHashes.map((r) => r.perceptual_hash),
  });

  if (dupCheck.matches.length) {
    await DuplicateDetector.recordAnalysis({
      userId,
      kind: 'duplicate',
      result: dupCheck,
      confidence: dupCheck.matches[0].similarity.total / 100,
    });
  }

  void autoModerate({
    issueId: issue.id,
    userId,
    text: b.description,
    context: `Issue #${issue.public_id} description`,
  });

  res.status(201).json({ issue, duplicateSuggestions: dupCheck.matches });
});

export const confirmIssue = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');

  const existing = await pool.query(
    'SELECT 1 FROM issue_confirmations WHERE issue_id = $1 AND user_id = $2',
    [issue.id, req.user.id],
  );
  if (!existing.rows[0]) {
    await pool.query(
      'INSERT INTO issue_confirmations (issue_id, user_id) VALUES ($1, $2)',
      [issue.id, req.user.id],
    );
    await computePriorityScore(issue.id);

    if (['REPORTED', 'AI_REVIEW'].includes(issue.status)) {
      const { rows: count } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM issue_confirmations WHERE issue_id = $1',
        [issue.id],
      );
      if (count[0].n >= 3) {
        await transitionStatus({ issue, toStatus: 'VERIFIED', changedBy: req.user.id, note: 'Reached 3 community confirmations' });
      }
    }

    await notifyReporter({
      issueId: issue.id,
      reporterId: issue.reporter_id,
      exceptUserId: req.user.id,
      type: 'issue_confirmed',
      title: `Someone confirmed your report #${issue.public_id}`,
      body: `A citizen confirmed "${issue.title}"`,
    });
  }
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM issue_confirmations WHERE issue_id = $1',
    [issue.id],
  );
  res.json({ confirmations: rows[0].n, confirmed: true });
});

export const upvoteIssue = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  await pool.query(
    `INSERT INTO issue_votes (issue_id, user_id, direction) VALUES ($1, $2, 'up')
     ON CONFLICT (issue_id, user_id) DO UPDATE SET direction = 'up'`,
    [issue.id, req.user.id],
  );
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE direction='up')::int AS up FROM issue_votes WHERE issue_id = $1`,
    [issue.id],
  );
  res.json({ upvotes: rows[0].up, upvoted: true });
});

export const unupvoteIssue = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  await pool.query('DELETE FROM issue_votes WHERE issue_id = $1 AND user_id = $2', [
    issue.id,
    req.user.id,
  ]);
  res.json({ upvotes: 0, upvoted: false });
});

export const addEvidence = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  const uploaded = req.evidenceUploads || [];
  if (!uploaded.length) throw ApiError.badRequest('At least one image is required');

  let firstImageId = null;
  for (const up of uploaded) {
    const { rows } = await pool.query(
      `INSERT INTO issue_images (issue_id, uploader_id, url, thumb_url, kind, is_primary, mime, width, height, size_bytes, perceptual_hash)
       VALUES ($1, $2, $3, $4, 'evidence', false, $5, $6, $7, $8, $9) RETURNING id`,
      [issue.id, req.user.id, up.url, up.thumb_url, up.mime, up.width, up.height, up.size_bytes, up.perceptual_hash],
    );
    firstImageId = firstImageId || rows[0].id;
  }

  await pool.query(
    `INSERT INTO issue_evidence (issue_id, evidence_type, image_id, submitted_by, note)
     VALUES ($1, 'citizen', $2, $3, $4)`,
    [issue.id, firstImageId, req.user.id, req.body.note || ''],
  );

  await notifyFollowers({
    issueId: issue.id,
    issueTitle: issue.title,
    type: 'new_evidence',
    title: `New evidence added to issue #${issue.public_id}`,
    body: `A citizen uploaded new evidence for "${issue.title}"`,
    exceptUserId: req.user.id,
  });

  res.status(201).json({ message: 'Evidence added' });
});

export const addComment = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  const { rows } = await pool.query(
    `INSERT INTO issue_comments (issue_id, user_id, body)
     VALUES ($1, $2, $3) RETURNING id, body, is_official, created_at, user_id`,
    [issue.id, req.user.id, req.body.body],
  );
  const comment = rows[0];
  comment.user_name = req.user.name;
  comment.user_role = req.user.role;
  comment.is_demo = false;
  void autoModerate({
    issueId: issue.id,
    commentId: comment.id,
    userId: req.user.id,
    text: req.body.body,
    context: `Comment on issue #${issue.public_id}`,
  });
  res.status(201).json({ comment });
});

export const deleteComment = asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM issue_comments WHERE id = $1', [req.params.commentId]);
  if (!rows[0]) throw ApiError.notFound('Comment not found');
  const comment = rows[0];
  const isMod = ['admin', 'moderator'].includes(req.user.role);
  if (!isMod && comment.user_id !== req.user.id) throw ApiError.forbidden();
  if (isMod) {
    await pool.query('UPDATE issue_comments SET is_hidden = true WHERE id = $1', [comment.id]);
  } else {
    await pool.query('DELETE FROM issue_comments WHERE id = $1', [comment.id]);
  }
  res.json({ message: 'Comment removed' });
});

export const followIssue = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  await pool.query(
    `INSERT INTO issue_followers (issue_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [issue.id, req.user.id],
  );
  res.json({ following: true });
});

export const unfollowIssue = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM issue_followers WHERE issue_id = $1 AND user_id = $2', [
    req.params.id,
    req.user.id,
  ]);
  res.json({ following: false });
});

export const reopenIssue = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  if (!['RESOLVED', 'VERIFIED_RESOLVED', 'REOPENED'].includes(issue.status)) {
    throw ApiError.badRequest('Only resolved issues can be reopened');
  }
  if (req.user.role === 'citizen') {
    const { rows } = await pool.query(
      'SELECT 1 FROM issue_confirmations WHERE issue_id = $1 AND user_id = $2',
      [issue.id, req.user.id],
    );
    if (!rows[0]) {
      throw ApiError.forbidden('You must confirm this issue before reopening it');
    }
  }
  await transitionStatus({
    issue,
    toStatus: 'REOPENED',
    changedBy: req.user.id,
    note: req.body.note || 'Reopened by citizen — the problem appears to still exist',
    force: true,
  });
  const fresh = await loadIssue(issue.id);
  res.json({ issue: fresh, message: 'Issue reopened' });
});

export const similarIssues = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  const { rows } = await pool.query(
    'SELECT perceptual_hash FROM issue_images WHERE issue_id = $1 AND perceptual_hash IS NOT NULL',
    [issue.id],
  );
  const result = await DuplicateDetector.check({
    lat: issue.lat,
    lng: issue.lng,
    categoryId: issue.category_id,
    perceptualHashes: rows.map((r) => r.perceptual_hash),
  });
  const matches = result.matches.filter((m) => m.issueId !== issue.id).slice(0, 5);
  res.json({ issues: matches });
});

export const reportIncorrect = asyncHandler(async (req, res) => {
  const issue = await loadIssue(req.params.id);
  if (!issue) throw ApiError.notFound('Issue not found');
  const reason = z
    .object({ reason: z.string().trim().min(3).max(500) })
    .safeParse(req.body);
  if (!reason.success) throw ApiError.badRequest('A short reason is required');
  await pool.query(
    `INSERT INTO moderation_reports (issue_id, reporter_id, reason)
     VALUES ($1, $2, $3)`,
    [issue.id, req.user.id, reason.data.reason],
  );
  res.status(201).json({ message: 'Reported. A moderator will review it.' });
});

export const myIssues = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.public_id, i.title, i.status, i.severity, i.priority_score,
            i.lat, i.lng, i.area, i.city, i.address, i.is_demo, i.created_at, i.reported_at,
            c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
            d.name AS department_name,
            (SELECT COUNT(*) FROM issue_confirmations x WHERE x.issue_id = i.id)::int AS confirmations,
            (SELECT COUNT(*) FROM issue_votes v WHERE v.issue_id = i.id AND v.direction = 'up')::int AS upvotes,
            (SELECT COUNT(*) FROM issue_comments co WHERE co.issue_id = i.id AND co.is_hidden = false)::int AS comments,
            COALESCE(
              (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary LIMIT 1),
              (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id ORDER BY x.created_at ASC LIMIT 1)
            ) AS cover_url,
            COALESCE(
              (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary LIMIT 1),
              (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id ORDER BY x.created_at ASC LIMIT 1)
            ) AS cover_thumb
       FROM issues i
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.reporter_id = $1 ORDER BY i.created_at DESC`,
    [req.user.id],
  );
  res.json({ issues: rows });
});

export const myConfirmedIssues = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.public_id, i.title, i.status, i.severity, i.priority_score,
            i.lat, i.lng, i.area, i.city, i.address, i.is_demo, i.created_at, i.reported_at,
            c.slug AS category_slug, c.name AS category_name, c.color AS category_color,
            d.name AS department_name,
            (SELECT COUNT(*) FROM issue_confirmations x WHERE x.issue_id = i.id)::int AS confirmations,
            (SELECT COUNT(*) FROM issue_votes v WHERE v.issue_id = i.id AND v.direction = 'up')::int AS upvotes,
            (SELECT COUNT(*) FROM issue_comments co WHERE co.issue_id = i.id AND co.is_hidden = false)::int AS comments,
            COALESCE(
              (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary LIMIT 1),
              (SELECT x.url FROM issue_images x WHERE x.issue_id = i.id ORDER BY x.created_at ASC LIMIT 1)
            ) AS cover_url,
            COALESCE(
              (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id AND x.is_primary LIMIT 1),
              (SELECT x.thumb_url FROM issue_images x WHERE x.issue_id = i.id ORDER BY x.created_at ASC LIMIT 1)
            ) AS cover_thumb
       FROM issue_confirmations cf
       JOIN issues i ON i.id = cf.issue_id
       JOIN categories c ON c.id = i.category_id
       LEFT JOIN departments d ON d.id = i.department_id
      WHERE cf.user_id = $1 ORDER BY cf.created_at DESC`,
    [req.user.id],
  );
  res.json({ issues: rows });
});

export async function analyzeEvidenceImage({ imageId, userId }) {
  const upload = await fetchUploadedImage(imageId, userId);
  if (!upload) throw ApiError.badRequest('Image not found or expired');
  return { upload, buffer: null };
}
