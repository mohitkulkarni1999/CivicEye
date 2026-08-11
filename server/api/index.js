import { app } from '../src/app.js';
import { testConnection } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';

// We test the connection on cold starts
testConnection().then(() => {
  logger.info('Connected to PostgreSQL (Vercel Serverless)');
}).catch((err) => {
  logger.error('Failed to connect to PostgreSQL', err);
});

// Export the express app for Vercel Serverless Functions
export default app;
