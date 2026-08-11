import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  register,
  login,
  me,
  registerSchema,
  loginSchema,
  listDemoAccounts,
} from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), asyncHandler(register));
router.post('/login', authLimiter, validate(loginSchema), asyncHandler(login));
router.get('/me', authenticate, asyncHandler(me));
router.get('/demo-accounts', asyncHandler(listDemoAccounts));

export default router;
