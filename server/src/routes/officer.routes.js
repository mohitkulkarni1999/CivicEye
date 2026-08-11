import { Router } from 'express';
import { authenticate, requireMinRank } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  getOfficerIssues,
  getOfficerStats,
  changeStatus,
  assignIssue,
  addOfficialUpdate,
} from '../controllers/officer.controller.js';

const router = Router();

router.use(authenticate, requireMinRank('officer'));

router.get('/issues', asyncHandler(getOfficerIssues));
router.get('/stats', asyncHandler(getOfficerStats));
router.patch('/issues/:id/status', asyncHandler(changeStatus));
router.post('/issues/:id/assign', asyncHandler(assignIssue));
router.post('/issues/:id/update', asyncHandler(addOfficialUpdate));

export default router;
