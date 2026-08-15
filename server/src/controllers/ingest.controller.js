import { z } from 'zod';
import { pool } from '../config/db.js';
import { runIngest, listSources } from '../services/ingest/index.js';

const runSchema = z.object({
  source: z.string().min(1),
  includeBoundaries: z.boolean().optional().default(false),
  // Optional raw CSV to ingest instead of fetching (test hook / admin correction).
  csvOverride: z.string().optional(),
});

export async function adminListIngestSources(req, res) {
  const { rows } = await pool.query(
    `SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 10`,
  );
  res.json({ sources: listSources(), recentRuns: rows });
}

export async function adminRunIngest(req, res) {
  const body = runSchema.parse(req.body || {});
  const result = await runIngest(body.source, {
    includeBoundaries: body.includeBoundaries,
    csvOverride: body.csvOverride,
    actorId: req.user?.id,
  });
  res.json({ run: result });
}
