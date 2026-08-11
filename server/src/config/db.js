import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client', err.message);
});

export async function query(text, params, options = {}) {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (env.dbLogging) {
    logger.debug(
      `SQL (${Date.now() - start}ms)`,
      text.slice(0, 300),
      params ? JSON.stringify(params).slice(0, 300) : '',
    );
  }
  return result;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function testConnection() {
  const { rows } = await query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}
