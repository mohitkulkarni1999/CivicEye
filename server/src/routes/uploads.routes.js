import { Router } from 'express';
import { multerImages, multerMedia } from '../middleware/multer.js';
import { imageUploadPipeline } from '../middleware/upload.js';
import { mediaUploadPipeline } from '../middleware/media.js';
import { optionalAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../config/db.js';

const router = Router();

router.post(
  '/images',
  optionalAuth,
  uploadLimiter,
  multerImages.array('images', 8),
  imageUploadPipeline('images', 8),
  asyncHandler(async (req, res) => {
    const uploads = req.imagesUploads || [];
    if (!uploads.length) {
      return res.status(400).json({ error: 'No valid images uploaded' });
    }
    res.status(201).json({ uploads });
  }),
);

router.post(
  '/media',
  optionalAuth,
  uploadLimiter,
  multerMedia.array('media', 4),
  mediaUploadPipeline('media', 4),
  asyncHandler(async (req, res) => {
    const uploads = req.mediaUploads || [];
    if (!uploads.length) {
      return res.status(400).json({ error: 'No valid media uploaded' });
    }
    res.status(201).json({ uploads });
  }),
);

// Tidy expired uploads (best effort, once a day-ish)
router.post('/purge-expired', optionalAuth, asyncHandler(async (_req, res) => {
  const { rows } = await query('DELETE FROM uploads WHERE expires_at < now() RETURNING id');
  res.json({ purged: rows.length });
}));

export default router;
