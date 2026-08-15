import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { resolveRepresentative } from '../controllers/representative.controller.js';

const router = Router();

router.get('/resolve', asyncHandler(resolveRepresentative));

export default router;
