import { Router } from 'express';
import { multerImages } from '../middleware/multer.js';
import { imageUploadPipeline } from '../middleware/upload.js';
import { authenticate, optionalAuth, requireMinRank } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  analyzeImage,
  checkDuplicate,
  verifyRepair,
  getStatus,
  moderateText,
  triageIssue,
  parseQuery,
  chat,
} from '../controllers/ai.controller.js';

const router = Router();

router.get('/status', asyncHandler(getStatus));

router.post(
  '/analyze-image',
  aiLimiter,
  optionalAuth,
  multerImages.array('images', 1),
  imageUploadPipeline('images', 1),
  asyncHandler(analyzeImage),
);

router.post(
  '/verify-repair',
  aiLimiter,
  optionalAuth,
  asyncHandler(verifyRepair),
);

router.post('/check-duplicate', aiLimiter, optionalAuth, asyncHandler(checkDuplicate));

router.post('/moderate-text', aiLimiter, optionalAuth, asyncHandler(moderateText));

router.post('/triage', aiLimiter, authenticate, requireMinRank('officer'), asyncHandler(triageIssue));

router.post('/parse-query', aiLimiter, optionalAuth, asyncHandler(parseQuery));

router.post('/chat', aiLimiter, optionalAuth, asyncHandler(chat));

export default router;
