import { pool } from '../config/db.js';

// Clears all user-generated data while KEEPING credentials (users) and
// reference data (departments, categories, locations, admin_settings).
const TABLES = [
  'moderation_reports',
  'notifications',
  'ai_analysis',
  'uploads',
  'issue_evidence',
  'issue_assignments',
  'issue_followers',
  'issue_comments',
  'issue_votes',
  'issue_confirmations',
  'issue_status_history',
  'issue_images',
  'issues',
];

async function counts(client) {
  const rows = [];
  for (const t of TABLES) {
    const { rows: [{ n }] } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    rows.push(`${t}=${n}`);
  }
  return rows.join(', ');
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Before:', await counts(client));
    await client.query('BEGIN');
    for (const t of TABLES) {
      await client.query(`TRUNCATE TABLE ${t} CASCADE`);
    }
    await client.query('COMMIT');
    console.log('After: ', await counts(client));
    console.log('Done. Kept: users (credentials), departments, categories, locations, admin_settings.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
