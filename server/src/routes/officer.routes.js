import { Router } from 'express';
import { authenticate, requireMinRank } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escalateLimiter } from '../middleware/rateLimit.js';
import {
  getOfficerIssues,
  getOfficerStats,
  changeStatus,
  assignIssue,
  addOfficialUpdate,
} from '../controllers/officer.controller.js';
import {
  approveEscalationAction,
  rejectEscalationAction,
  publishEscalationAction,
  retryEscalationAction,
  updateEscalationTextAction,
} from '../controllers/escalation.controller.js';

const router = Router();

router.use(authenticate, requireMinRank('officer'));

router.get('/issues', asyncHandler(getOfficerIssues));
router.get('/stats', asyncHandler(getOfficerStats));
router.patch('/issues/:id/status', asyncHandler(changeStatus));
router.post('/issues/:id/assign', asyncHandler(assignIssue));
router.post('/issues/:id/update', asyncHandler(addOfficialUpdate));

router.post('/escalations/:id/approve', escalateLimiter, asyncHandler(approveEscalationAction));
router.post('/escalations/:id/reject', escalateLimiter, asyncHandler(rejectEscalationAction));
router.post('/escalations/:id/publish', escalateLimiter, asyncHandler(publishEscalationAction));
router.post('/escalations/:id/retry', escalateLimiter, asyncHandler(retryEscalationAction));
router.post('/escalations/:id/text', escalateLimiter, asyncHandler(updateEscalationTextAction));

export default router;
