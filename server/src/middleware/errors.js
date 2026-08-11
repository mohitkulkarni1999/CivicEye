import { asyncHandler } from '../utils/asyncHandler.js';

export const notFoundHandler = (req, res, next) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
};

export const errorHandler = (err, req, res, _next) => {
  if (err?.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }

  if (err?.code === '23505') {
    return res.status(409).json({ error: 'Duplicate entry' });
  }

  console.error('[ERROR]', err);
  return res.status(500).json({ error: 'Internal server error' });
};
