import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { aiService } from '../services/ai/index.js';
import { DuplicateDetector } from '../services/duplicate.service.js';
import { fetchUploadedImage } from '../middleware/upload.js';
import { UPLOAD_DIR } from '../services/storage/index.js';

function filePathFromUpload(upload) {
  const rel = upload.url.replace('/uploads/', '');
  return join(UPLOAD_DIR, rel);
}

async function recordAnalysis({ userId, kind, result, confidence, issueId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO ai_analysis (user_id, kind, provider, model, result, confidence, issue_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
    [
      userId,
      kind,
      result.provider,
      result.mode === 'vision' ? aiService.providerName : null,
      JSON.stringify(result),
      confidence ?? result.confidence ?? 0,
      issueId,
    ],
  );
  return rows[0];
}

export const analyzeImage = asyncHandler(async (req, res) => {
  const uploaded = req.imagesUploads?.[0];
  let upload = null;
  if (uploaded) {
    upload = uploaded;
  } else if (req.body?.imageId) {
    upload = await fetchUploadedImage(req.body.imageId, req.user?.id || null);
    if (!upload) throw ApiError.badRequest('Image not found or expired');
  }
  if (!upload) throw ApiError.badRequest('An image is required for analysis');

  const analysis = await aiService.analyzeCivicImage({ imageUrl: upload.url });

  const { rows } = await pool.query(
    `INSERT INTO ai_analysis (user_id, kind, input_image_ids, provider, model, result, confidence)
     VALUES ($1, 'image', $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [
      req.user?.id || null,
      JSON.stringify([upload.id]),
      analysis.provider,
      analysis.mode === 'vision' ? aiService.providerName : null,
      JSON.stringify(analysis),
      analysis.confidence,
    ],
  );

  res.json({ analysis, analysisId: rows[0].id });
});

export const checkDuplicate = asyncHandler(async (req, res) => {
  const schema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    categoryId: z.string().uuid().optional(),
    imageIds: z.array(z.string().uuid()).max(8).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid duplicate check payload');

  let hashes = [];
  if (parsed.data.imageIds.length) {
    const { rows } = await pool.query(
      'SELECT perceptual_hash FROM uploads WHERE id = ANY($1) AND perceptual_hash IS NOT NULL',
      [parsed.data.imageIds],
    );
    hashes = rows.map((r) => r.perceptual_hash);
  }

  const result = await DuplicateDetector.check({
    lat: parsed.data.lat,
    lng: parsed.data.lng,
    categoryId: parsed.data.categoryId,
    perceptualHashes: hashes,
  });

  if (result.matches.length) {
    await DuplicateDetector.recordAnalysis({
      userId: req.user?.id || null,
      kind: 'duplicate',
      result,
      confidence: result.matches[0].similarity.total / 100,
    });
  }

  res.json(result);
});

export const verifyRepair = asyncHandler(async (req, res) => {
  const schema = z.object({
    beforeImageId: z.string().uuid(),
    afterImageId: z.string().uuid(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Both before and after images are required');

  const before = await fetchUploadedImage(parsed.data.beforeImageId, req.user?.id || null);
  const after = await fetchUploadedImage(parsed.data.afterImageId, req.user?.id || null);
  if (!before || !after) throw ApiError.badRequest('Image not found or expired');

  const verification = await aiService.verifyRepair({
    beforeUrl: before.url,
    afterUrl: after.url,
  });

  const { rows } = await pool.query(
    `INSERT INTO ai_analysis (user_id, kind, input_image_ids, provider, model, result, confidence)
     VALUES ($1, 'repair_verification', $2, $3, $4, $5, $6) RETURNING id`,
    [
      req.user?.id || null,
      JSON.stringify([before.id, after.id]),
      verification.provider,
      verification.mode === 'vision' ? aiService.providerName : null,
      JSON.stringify(verification),
      verification.confidence,
    ],
  );

  res.json({ verification, analysisId: rows[0].id });
});

export const getStatus = asyncHandler(async (_req, res) => {
  res.json({
    provider: aiService.providerName,
    label: aiService.label,
    mode: aiService.providerName === 'heuristic' ? 'local' : 'vision',
    description:
      aiService.providerName === 'heuristic'
        ? 'Running offline rule-based analysis. Configure OPENAI_API_KEY or GEMINI_API_KEY for full vision classification.'
        : 'Running a configured vision model.',
  });
});

export const moderateText = asyncHandler(async (req, res) => {
  const schema = z.object({
    text: z.string().trim().min(1).max(2000),
    context: z.string().trim().max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('Invalid moderation payload');

  const result = await aiService.moderateText(parsed.data);
  const analysis = await recordAnalysis({
    userId: req.user?.id || null,
    kind: 'moderation',
    result,
    confidence: result.score,
  });
  res.json({ ...result, analysisId: analysis.id });
});

export const triageIssue = asyncHandler(async (req, res) => {
  const schema = z.object({ issueId: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('A valid issueId is required');

  const issueRes = await pool.query('SELECT * FROM issues WHERE id = $1', [parsed.data.issueId]);
  const issue = issueRes.rows[0];
  if (!issue) throw ApiError.notFound('Issue not found');

  const [catRes, deptRes] = await Promise.all([
    pool.query('SELECT name, slug FROM categories WHERE id = $1', [issue.category_id]),
    pool.query('SELECT id, name FROM departments ORDER BY name'),
  ]);

  const result = await aiService.triageIssue({
    issue: {
      ...issue,
      category_name: catRes.rows[0]?.name || '',
      category_slug: catRes.rows[0]?.slug || '',
      priority_factors: issue.priority_factors,
    },
    departments: deptRes.rows,
  });

  const analysis = await recordAnalysis({
    userId: req.user.id,
    kind: 'triage',
    result,
    confidence: result.confidence,
    issueId: issue.id,
  });
  res.json({ suggestion: result, analysisId: analysis.id });
});

export const parseQuery = asyncHandler(async (req, res) => {
  const schema = z.object({ q: z.string().trim().min(1).max(300) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('A search query is required');

  const { rows } = await pool.query('SELECT name, slug FROM categories WHERE is_active = true');
  const result = await aiService.parseQuery({ q: parsed.data.q, categories: rows });
  const analysis = await recordAnalysis({
    userId: req.user?.id || null,
    kind: 'query_parse',
    result,
    confidence: null,
  });
  res.json({ ...result, analysisId: analysis.id });
});

export const chat = asyncHandler(async (req, res) => {
  const schema = z.object({
    query: z.string().trim().min(1).max(500),
    issueId: z.string().uuid().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest('A question is required');

  const context = [
    {
      section: 'About CivicEye',
      content:
        'CivicEye lets citizens report civic problems like potholes, garbage, broken streetlights, and water leaks with photos and a map pin. Reports are verified with AI, assigned to the right department, and followed until resolved.',
    },
    {
      section: 'How to report',
      content:
        'Open the Report page, pick a category, add one or more photos, describe the problem, drop a pin on the map for the exact location, and submit. You can report anonymously. After submitting, your report gets a public number you can share.',
    },
    {
      section: 'Who leads my area',
      content:
        'On a report detail page or the report form, the "Who leads this area" card shows the elected representative (Nagar Sevak / Corporator / Sarpanch) responsible for that locality, including their political party.',
    },
  ];

  if (parsed.data.issueId) {
    const issueRes = await pool.query('SELECT * FROM issues WHERE id = $1', [parsed.data.issueId]);
    const issue = issueRes.rows[0];
    if (issue) {
      const [catRes, histRes] = await Promise.all([
        pool.query('SELECT name FROM categories WHERE id = $1', [issue.category_id]),
        pool.query(
          `SELECT from_status, to_status, note, created_at
             FROM issue_status_history WHERE issue_id = $1
            ORDER BY created_at DESC LIMIT 6`,
          [issue.id],
        ),
      ]);
      context.push({
        section: `Issue #${issue.public_id}`,
        content:
          `Title: ${issue.title}. Status: ${issue.status}. Category: ${catRes.rows[0]?.name || ''}. ` +
          `Severity: ${issue.severity}. Area: ${issue.area || ''}. City: ${issue.city || ''}. ` +
          `Reported: ${issue.reported_at}. Priority score: ${issue.priority_score ?? 0}. ` +
          `Recent history: ${histRes.rows.map((h) => `${h.to_status} (${h.note || 'no note'})`).join('; ') || 'none'}.`,
      });
    }
  }

  const result = await aiService.respond({ query: parsed.data.query, context });
  const analysis = await recordAnalysis({
    userId: req.user?.id || null,
    kind: 'chat',
    result,
    confidence: null,
    issueId: parsed.data.issueId || null,
  });
  res.json({ reply: result.reply, sources: result.sources, analysisId: analysis.id });
});
