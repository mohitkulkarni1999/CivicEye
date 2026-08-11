import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { testConnection } from './config/db.js';
import { runMigrations } from './db/migrate.js';

async function start() {
  await testConnection();
  logger.info('Connected to PostgreSQL');

  await runMigrations();

  if (env.demoMode) {
    const { ensureDevAccounts } = await import('./db/seed.js');
    await ensureDevAccounts();
  }

  app.listen(env.port, () => {
    logger.info(`CivicEye API listening on http://localhost:${env.port}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
