import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { requestLogger } from './middleware/logger.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { PUBLIC_UPLOAD_BASE, UPLOAD_DIR } from './services/storage/index.js';

import authRoutes from './routes/auth.routes.js';
import metaRoutes from './routes/meta.routes.js';
import uploadsRoutes from './routes/uploads.routes.js';
import issuesRoutes from './routes/issues.routes.js';
import mapRoutes from './routes/map.routes.js';
import cityRoutes from './routes/city.routes.js';
import aiRoutes from './routes/ai.routes.js';
import officerRoutes from './routes/officer.routes.js';
import adminRoutes from './routes/admin.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import locationsRoutes from './routes/locations.routes.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: env.isProd ? env.clientUrl : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(requestLogger);
app.use(generalLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'civiceye-api', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api', metaRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/issues', issuesRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/city', cityRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/officer', officerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/locations', locationsRoutes);

// Static uploads (local storage driver)
app.use(PUBLIC_UPLOAD_BASE, express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.use(notFoundHandler);
app.use(errorHandler);
