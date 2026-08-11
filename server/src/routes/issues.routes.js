import { Router } from 'express';
import { multerImages } from '../middleware/multer.js';
import { imageUploadPipeline } from '../middleware/upload.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createIssue,
  createIssueSchema,
  listIssues,
  getIssue,
  confirmIssue,
  upvoteIssue,
  unupvoteIssue,
  addEvidence,
  addComment,
  deleteComment,
  followIssue,
  unfollowIssue,
  reopenIssue,
  similarIssues,
  reportIncorrect,
  myIssues,
  myConfirmedIssues,
} from '../controllers/issues.controller.js';

const router = Router();

router.post('/', optionalAuth, validate(createIssueSchema), asyncHandler(createIssue));
router.get('/', asyncHandler(listIssues));
router.get('/my', authenticate, asyncHandler(myIssues));
router.get('/my/confirmed', authenticate, asyncHandler(myConfirmedIssues));
router.get('/:id', optionalAuth, asyncHandler(getIssue));

router.post('/:id/confirm', authenticate, asyncHandler(confirmIssue));
router.post('/:id/upvote', authenticate, asyncHandler(upvoteIssue));
router.post('/:id/unupvote', authenticate, asyncHandler(unupvoteIssue));
router.post(
  '/:id/evidence',
  authenticate,
  uploadLimiter,
  multerImages.array('images', 6),
  imageUploadPipeline('images', 6),
  asyncHandler(addEvidence),
);
router.post('/:id/comments', authenticate, asyncHandler(addComment));
router.delete('/:id/comments/:commentId', authenticate, asyncHandler(deleteComment));
router.post('/:id/follow', authenticate, asyncHandler(followIssue));
router.post('/:id/unfollow', authenticate, asyncHandler(unfollowIssue));
router.post('/:id/reopen', authenticate, asyncHandler(reopenIssue));
router.get('/:id/similar', optionalAuth, asyncHandler(similarIssues));
router.post('/:id/report-incorrect', authenticate, asyncHandler(reportIncorrect));

export default router;
