/**
 * Automatic official-source ingestion.
 *
 * Fetches elected-representative data from authoritative machine-readable
 * sources (state election commission results) and imports it deterministically.
 *
 * "No wrong person" guarantees:
 *   1. Names/parties/seats come ONLY from the official source payload — never
 *      AI-guessed, never derived from locality or candidate lists.
 *   2. X handles are NEVER written by ingestion (official_x_username stays
 *      empty), so a post can only be drafted after an admin verifies the
 *      account — the existing verification gate.
 *   3. Adoption is by (ward, seat) — one seat, one elected member — and every
 *      imported row carries a source_key (idempotent upsert) plus source_url so
 *      provenance is auditable.
 *   4. Re-runs are idempotent; stale source rows are demoted, never deleted.
 */
import { pool } from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { logAudit } from '../audit.service.js';
import { setWardBoundaryFromRings } from '../representative.service.js';
import { sources } from './sources/index.js';
import { fetchWardBoundariesFromOverpass } from './boundaries.js';

export function listSources() {
  return Object.values(sources).map((s) => ({
    id: s.id,
    label: s.label,
    corporationCode: s.corporationCode,
    sourceUrl: s.sourceUrl,
  }));
}

async function ensureCorporation({ code, name, city }) {
  const { rows } = await pool.query(
    `INSERT INTO corporations (code, name, city)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, city = EXCLUDED.city, is_active = true
     RETURNING *`,
    [code, name, city],
  );
  return rows[0];
}

async function upsertWard({ corporationId, city, wardNumber, wardName, source, sourceUrl }) {
  const { rows } = await pool.query(
    `INSERT INTO wards (city, ward_number, ward_name, corporation_id, source, source_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (corporation_id, ward_number) WHERE corporation_id IS NOT NULL
     DO UPDATE SET
       ward_name = CASE WHEN wards.source IN ('', 'seed_approximation')
                        THEN EXCLUDED.ward_name ELSE wards.ward_name END,
       source = CASE WHEN wards.source IN ('', 'seed_approximation')
                     THEN EXCLUDED.source ELSE wards.source END,
       source_url = CASE WHEN wards.source IN ('', 'seed_approximation')
                         THEN EXCLUDED.source_url ELSE wards.source_url END,
       is_active = true
     RETURNING *`,
    [city, wardNumber, wardName, corporationId, source, sourceUrl],
  );
  return rows[0];
}

/**
 * Normalize a ward number to the app convention 'Ward N'. Official CSVs use
 * bare numbers ('32'); the app (localities, seeds, resolution) uses 'Ward 32'.
 * Normalizing lets ingestion merge into existing wards instead of creating
 * parallel rows that never get the boundary polygon.
 */
export function normalizeWardNumber(raw) {
  const s = String(raw || '').trim();
  const bare = s.match(/^(\d{1,4})$/);
  if (bare) return `Ward ${bare[1]}`;
  const prefixed = s.match(/^Ward\s*(\d{1,4})$/i);
  if (prefixed) return `Ward ${prefixed[1]}`;
  return s;
}

function normalizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function nameTokens(name) {
  return normalizeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function sharedTokenCount(a, b) {
  const set = new Set(nameTokens(b));
  return nameTokens(a).filter((t) => set.has(t)).length;
}

async function ensureWardRepLink(wardId, representativeId, seat) {
  await pool.query(
    `INSERT INTO ward_representatives (ward_id, representative_id, seat, is_current)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (ward_id, representative_id) DO UPDATE SET
       seat = EXCLUDED.seat, is_current = true`,
    [wardId, representativeId, seat],
  );
}

/**
 * Upsert a representative for one (ward, seat). Adopts an existing rep on that
 * seat (preserving admin X-verification), updates its official fields, and
 * links it to the ward. Returns the representative row.
 */
async function upsertRepForSeat({ wardId, corporationId, seat, name, party, designation, constituency, dataSource, sourceUrl, sourceKey, notes }) {
  const cleanName = normalizeName(name);
  const cleanSeat = (seat || '').trim();

  // 1. Idempotent re-run: the row already carries this source_key.
  const byKey = await pool.query(
    `UPDATE representatives SET
       name = $1, party = $2, seat = $3, designation = $4, constituency = $5,
       data_source = $6, source_url = $7, corporation_id = $8, is_current = true, notes = $9
     WHERE source_key = $10
     RETURNING *`,
    [cleanName, (party || '').trim(), cleanSeat, designation, constituency, dataSource, sourceUrl, corporationId, notes, sourceKey],
  );
  if (byKey.rows[0]) {
    await ensureWardRepLink(wardId, byKey.rows[0].id, cleanSeat);
    return byKey.rows[0];
  }

  // 2. Adoption: an existing representative already holds this ward+seat
  //    (e.g. seeded earlier under a different name spelling). Adopt it by
  //    claiming the source_key — preserves admin verification.
  const holders = await pool.query(
    `SELECT r.* FROM representatives r
     JOIN ward_representatives wr ON wr.representative_id = r.id
     WHERE wr.ward_id = $1 AND r.seat = $2 AND wr.is_current = true
       AND (r.source_key IS NULL OR r.source_key = $3)`,
    [wardId, cleanSeat, sourceKey],
  );
  if (holders.rows.length) {
    const incoming = nameTokens(cleanName);
    let best = holders.rows[0];
    let bestScore = -1;
    for (const h of holders.rows) {
      const score = sharedTokenCount(cleanName, h.name);
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    const { rows } = await pool.query(
      `UPDATE representatives SET
         name = $1, party = $2, seat = $3, designation = $4, constituency = $5,
         data_source = $6, source_url = $7, corporation_id = $8, is_current = true,
         notes = $9, source_key = $10
       WHERE id = $11
       RETURNING *`,
      [cleanName, (party || '').trim(), cleanSeat, designation, constituency, dataSource, sourceUrl, corporationId, notes, sourceKey, best.id],
    );
    await ensureWardRepLink(wardId, rows[0].id, cleanSeat);
    return rows[0];
  }

  // 3. Fresh insert + link.
  const { rows } = await pool.query(
    `INSERT INTO representatives
       (name, designation, constituency, official_x_username, official_x_user_id,
        x_profile_url, x_verified_by_admin, data_source, source_url,
        is_current, notes, corporation_id, party, seat, source_key)
     VALUES ($1, $2, $3, '', '', '', false, $4, $5, true, $6, $7, $8, $9, $10)
     RETURNING *`,
    [cleanName, designation, constituency, dataSource, sourceUrl, notes, corporationId, (party || '').trim(), cleanSeat, sourceKey],
  );
  await ensureWardRepLink(wardId, rows[0].id, cleanSeat);
  return rows[0];
}

/** Demote stale ingested reps of a ward (new election / seat removed). */
async function demoteStaleSeats(wardId, sourceKeyPrefix, activeKeys) {
  await pool.query(
    `UPDATE ward_representatives wr SET is_current = false
     FROM representatives r
     WHERE wr.ward_id = $1 AND wr.representative_id = r.id
       AND r.source_key IS NOT NULL
       AND r.source_key LIKE $2 || '%'
       AND NOT (r.source_key = ANY($3))`,
    [wardId, sourceKeyPrefix, activeKeys],
  );
  await pool.query(
    `UPDATE representatives r SET is_current = false
     FROM ward_representatives wr
     WHERE wr.ward_id = $1 AND wr.representative_id = r.id
       AND r.source_key IS NOT NULL
       AND r.source_key LIKE $2 || '%'
       AND NOT (r.source_key = ANY($3))`,
    [wardId, sourceKeyPrefix, activeKeys],
  );
}

/**
 * Run an ingestion for a registered source.
 * @param {string} sourceId  id in the registry (e.g. 'pmc_2026')
 * @param {object} opts
 * @param {boolean} [opts.includeBoundaries] try to fetch OSM ward polygons too
 * @param {string}  [opts.csvOverride]        raw CSV to use instead of fetching (tests)
 * @param {string}  [opts.actorId]            acting user for the audit trail
 */
export async function runIngest(sourceId, { includeBoundaries = false, csvOverride = null, actorId = null } = {}) {
  const source = sources[sourceId];
  if (!source) throw new Error(`Unknown ingestion source: ${sourceId}`);

  const run = await pool.query(
    `INSERT INTO ingest_runs (source, corporation_code, status)
     VALUES ($1, $2, 'running') RETURNING *`,
    [sourceId, source.corporationCode],
  );
  const runId = run.rows[0].id;

  const summary = {
    corporationCode: source.corporationCode,
    wards: 0,
    representatives: 0,
    boundariesApplied: 0,
    boundariesUnmatched: [],
    notes: [],
  };

  try {
    const csvText = csvOverride ?? await source.fetchCsv();
    const genericRows = parseCsv(csvText);
    const rows = source.mapRows ? source.mapRows(genericRows) : genericRows;

    const corporation = await ensureCorporation({
      code: source.corporationCode,
      name: source.corporationName,
      city: source.city,
    });

    // Group by ward number, preserving seat rows in order.
    const byWard = new Map();
    for (const row of rows) {
      if (!row.name) continue;
      if (!byWard.has(row.wardNumber)) byWard.set(row.wardNumber, []);
      byWard.get(row.wardNumber).push(row);
    }

    for (const [rawWardNumber, seatRows] of byWard) {
      const wardNumberKey = normalizeWardNumber(rawWardNumber);
      const wardName = seatRows.find((r) => r.wardName)?.wardName || '';
      const ward = await upsertWard({
        corporationId: corporation.id,
        city: source.city,
        wardNumber: wardNumberKey,
        wardName,
        source: source.sourceCodeForWard || 'official_gazette',
        sourceUrl: source.sourceUrl,
      });

      const sourceKeyPrefix = `${source.dataSource}:ward:${wardNumberKey}`;
      const activeKeys = [];
      for (const row of seatRows) {
        const seat = (row.seat || '').trim();
        const sourceKey = `${sourceKeyPrefix}:seat:${seat || 'primary'}`;
        const rep = await upsertRepForSeat({
          wardId: ward.id,
          corporationId: corporation.id,
          seat,
          name: row.name,
          party: row.party,
          designation: source.designation,
          constituency: source.constituencyFor(wardNumberKey, wardName, seat),
          dataSource: source.dataSource,
          sourceUrl: source.sourceUrl,
          sourceKey,
          notes: row.reservation ? `Reservation: ${row.reservation}` : '',
        });
        activeKeys.push(sourceKey);
        summary.representatives++;
      }
      await demoteStaleSeats(ward.id, `${sourceKeyPrefix}:`, activeKeys);
      summary.wards++;
    }

    // Best-effort official ward polygons (never blocks the winners import).
    if (includeBoundaries) {
      try {
        const result = await fetchWardBoundariesFromOverpass({
          cityName: source.city,
          corporationCode: source.corporationCode,
        });
        summary.boundariesApplied = result.applied;
        summary.boundariesUnmatched = result.unmatched;
        if (result.notes.length) summary.notes.push(...result.notes);
      } catch (err) {
        summary.notes.push(`Boundaries skipped: ${err.message}`);
        logger.warn({ err, source: sourceId }, '[INGEST] boundary fetch failed');
      }
    }

    await pool.query(
      `UPDATE ingest_runs SET status = 'ok', summary = $1::jsonb, finished_at = now()
       WHERE id = $2`,
      [JSON.stringify(summary), runId],
    );
    await logAudit({
      actorId,
      action: 'ingest.run',
      entityType: 'ingest_run',
      entityId: runId,
      details: { source: sourceId, summary },
    });
    logger.info({ source: sourceId, summary }, '[INGEST] complete');
    return { ...run.rows[0], status: 'ok', summary };
  } catch (err) {
    await pool.query(
      `UPDATE ingest_runs SET status = 'failed', error = $1, finished_at = now()
       WHERE id = $2`,
      [err.message, runId],
    );
    await logAudit({
      actorId,
      action: 'ingest.failed',
      entityType: 'ingest_run',
      entityId: runId,
      details: { source: sourceId, error: err.message },
    });
    logger.error({ err, source: sourceId }, '[INGEST] failed');
    throw err;
  }
}

/** Minimal CSV parser: handles double-quoted fields, commas inside quotes, CRLF. */
export function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (cols.length < header.length) continue;
    const row = {};
    header.forEach((h, i) => {
      const key = h.replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      row[key] = (cols[i] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}
