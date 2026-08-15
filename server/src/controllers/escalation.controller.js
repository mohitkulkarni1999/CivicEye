import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  approveEscalation,
  rejectEscalation,
  markEscalationPublished,
  retryEscalation,
  updateEscalationText,
  listEscalations,
  getEscalationById,
} from '../services/escalation.service.js';
import { buildXShareUrl } from '../services/post-generator.service.js';

/**
 * Load an escalation and enforce department scope for officers. Admins are
 * unrestricted; officers may only act on escalations for their department.
 */
async function loadScopedEscalation(id, user) {
  const esc = await getEscalationById(id);
  if (!esc) throw ApiError.notFound('Escalation not found');
  if (user?.role === 'officer' && user.department_id && esc.department_id !== user.department_id) {
    throw ApiError.forbidden('This escalation belongs to another department');
  }
  return esc;
}

export const listEscalationsAdmin = asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = await listEscalations({ status, limit, offset });
  res.json({
    escalations: rows,
    limit,
    offset,
  });
});

export const approveEscalationAction = asyncHandler(async (req, res) => {
  const esc = await loadScopedEscalation(req.params.id, req.user);
  const updated = await approveEscalation(esc.id, req.user.id);
  res.json({
    escalation: updated,
    shareUrl: buildXShareUrl(updated.generated_text || ''),
  });
});

export const rejectEscalationAction = asyncHandler(async (req, res) => {
  const esc = await loadScopedEscalation(req.params.id, req.user);
  const reason = z
    .object({ reason: z.string().trim().max(1000).optional().or(z.literal('')) })
    .safeParse(req.body);
  if (!reason.success) throw ApiError.badRequest('Invalid rejection payload');
  const updated = await rejectEscalation(esc.id, req.user.id, reason.data.reason || '');
  res.json({ escalation: updated });
});

export const publishEscalationAction = asyncHandler(async (req, res) => {
  const esc = await loadScopedEscalation(req.params.id, req.user);
  const body = z
    .object({
      postUrl: z.string().trim().url('A valid post URL is required').max(500),
      postId: z.string().trim().max(100).optional().or(z.literal('')),
    })
    .safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('A valid public post URL is required');
  const updated = await markEscalationPublished(esc.id, req.user.id, {
    postUrl: body.data.postUrl,
    postId: body.data.postId || '',
  });
  res.json({ escalation: updated });
});

export const retryEscalationAction = asyncHandler(async (req, res) => {
  const esc = await loadScopedEscalation(req.params.id, req.user);
  const updated = await retryEscalation(esc.id, req.user.id);
  res.json({ escalation: updated });
});

export const updateEscalationTextAction = asyncHandler(async (req, res) => {
  const esc = await loadScopedEscalation(req.params.id, req.user);
  const body = z
    .object({ text: z.string().trim().min(1).max(280, 'X posts are limited to 280 characters') })
    .safeParse(req.body);
  if (!body.success) throw ApiError.badRequest('Post text must be 1–280 characters');
  const updated = await updateEscalationText(esc.id, body.data.text, { actorId: req.user.id });
  res.json({ escalation: updated, shareUrl: buildXShareUrl(updated.generated_text) });
});
