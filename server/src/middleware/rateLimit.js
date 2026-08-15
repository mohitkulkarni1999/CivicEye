import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const generalLimiter = rateLimit({
  windowMs: env.rateLimitWindow,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res) => {
    throw ApiError.tooMany();
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res) => {
    throw ApiError.tooMany('Too many attempts. Try again later.');
  },
});

export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res) => {
    throw ApiError.tooMany('AI analysis rate limit reached. Try again in a moment.');
  },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res) => {
    throw ApiError.tooMany('Upload limit reached. Try again in a moment.');
  },
});

export const escalateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res) => {
    throw ApiError.tooMany('Escalation action rate limit reached. Try again in a moment.');
  },
});
