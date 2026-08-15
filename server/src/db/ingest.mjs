/**
 * Automatic official-source ingestion CLI.
 *
 *   npm run ingest                  # PMC 2026 winners (no OSM boundaries)
 *   npm run ingest -- --boundaries  # also fetch OSM ward polygons
 *   node src/db/ingest.mjs pmc_2026 --boundaries
 *
 * Fetches ward-wise election winners from official state election commission
 * data and imports them idempotently. Never writes X handles.
 */
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { runIngest, listSources } from '../services/ingest/index.js';

const args = process.argv.slice(2);
const sourceId = args.find((a) => !a.startsWith('--')) || 'pmc_2026';
const includeBoundaries = args.includes('--boundaries');

async function main() {
  logger.info({ sources: listSources() }, 'Available ingest sources');
  logger.info({ sourceId, includeBoundaries }, 'Starting ingest...');
  const result = await runIngest(sourceId, { includeBoundaries });
  logger.info({ result }, 'Ingest finished');
  console.log('\n=== INGEST SUMMARY ===');
  console.log(JSON.stringify(result.summary, null, 2));
  return result.status === 'ok' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      logger.error('Ingest failed:', err.message);
      process.exit(1);
    });
}
