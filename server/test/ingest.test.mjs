// CivicEye automatic-ingestion test suite.
//
// Verifies the "fetch automatically, no wrong person" pipeline:
//   A. Source connector parses the official PMC-2026 CSV layout correctly.
//   B. runIngest imports ward winners idempotently (no duplicates).
//   C. Adoption: Ward 32's existing reps are adopted (seat-based), NOT
//      duplicated, and names/parties come from the official payload.
//   D. No wrong person: imported reps NEVER get an X handle or admin
//      verification — escalation stays locked until an admin verifies.
//   E. Stale seats are demoted, not deleted, and can be re-adopted.
//   F. The admin API exposes sources and can trigger a run.
//   G. Resolution at Warje still returns the four Ward-32 corporators.
//
// Usage (from the server/ directory):
//   node test/ingest.test.mjs
//   TEST_BASE_URL=http://localhost:4000 node test/ingest.test.mjs
//
// Re-runnable. Cleans up its temporary ward afterwards.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { env as nodeEnv } from 'node:process';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

const TEST_BASE_URL = nodeEnv.TEST_BASE_URL;
const PASSWORD = 'CivicEye@2026';

const FIXTURE_FULL = `Ward No.,Ward Name,Seat,Reservation,Elected Candidate Name,Party
32,Warje-Popular Nagar,A,SC (Women),Bhosale Harshada Shantanu,BJP
32,,B,OBC,Barate Bharatbhushan Sharadchandra,BJP
32,,C,General (Women),Vanjale Sayali Ramesh,BJP
32,,D,General,Dodke Sachin Shivaji,BJP
99,Fixture Test Ward,A,SC (Women),Fixture One Person,BJP
99,,B,OBC,Fixture Two Person,NCP
99,,C,General (Women),Fixture Three Person,INC
99,,D,General,Fixture Four Person,SS`;

const FIXTURE_MISSING_SEAT_D = `Ward No.,Ward Name,Seat,Reservation,Elected Candidate Name,Party
32,Warje-Popular Nagar,A,SC (Women),Bhosale Harshada Shantanu,BJP
32,,B,OBC,Barate Bharatbhushan Sharadchandra,BJP
32,,C,General (Women),Vanjale Sayali Ramesh,BJP
99,Fixture Test Ward,A,SC (Women),Fixture One Person,BJP
99,,B,OBC,Fixture Two Person,NCP
99,,C,General (Women),Fixture Three Person,INC`;

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}
function section(title) {
  console.log(`\n-- ${title} --`);
}

async function api(base, path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

let server;

async function main() {
  let base;
  if (TEST_BASE_URL) {
    base = TEST_BASE_URL;
  } else {
    const { app } = await import(pathToFileURL(join(srcDir, 'app.js')).href);
    const { ensureDevAccounts } = await import(pathToFileURL(join(srcDir, 'db', 'seed.js')).href);
    await ensureDevAccounts();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://localhost:${server.address().port}`;
  }
  const { pool } = await import(pathToFileURL(join(srcDir, 'config', 'db.js')).href);
  const { runIngest } = await import(pathToFileURL(join(srcDir, 'services', 'ingest', 'index.js')).href);
  const { parseCsv, listSources } = await import(pathToFileURL(join(srcDir, 'services', 'ingest', 'index.js')).href);
  const { PMC2026 } = await import(pathToFileURL(join(srcDir, 'services', 'ingest', 'sources', 'pmc2026.js')).href);

  const sql = {
    ward32: () => pool.query(
      `SELECT w.id, w.ward_name, w.source FROM wards w
        JOIN corporations c ON c.id = w.corporation_id
       WHERE c.code = 'PMC' AND w.ward_number = 'Ward 32'`,
    ),
    ward32Reps: () => pool.query(
      `SELECT r.id, r.name, r.seat, r.party, r.data_source, r.source_key,
              r.official_x_username, r.x_verified_by_admin, r.is_current
         FROM representatives r
         JOIN ward_representatives wr ON wr.representative_id = r.id
         JOIN wards w ON w.id = wr.ward_id
        WHERE w.ward_number = 'Ward 32' AND w.corporation_id = (SELECT id FROM corporations WHERE code = 'PMC')
          AND wr.is_current = true
        ORDER BY r.seat`,
    ),
    ward99Reps: (currentOnly = true) => pool.query(
      `SELECT r.id, r.name, r.seat, r.source_key, r.is_current
         FROM representatives r
         JOIN ward_representatives wr ON wr.representative_id = r.id
         JOIN wards w ON w.id = wr.ward_id
        WHERE w.ward_number = 'Ward 99' AND w.corporation_id = (SELECT id FROM corporations WHERE code = 'PMC')
          ${currentOnly ? 'AND wr.is_current = true' : ''}
        ORDER BY r.seat`,
    ),
    sourceKeyDupes: () => pool.query(
      `SELECT source_key, count(*) FROM representatives WHERE source_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
    ),
    ingestedWithX: () => pool.query(
      `SELECT count(*)::int AS n FROM representatives
        WHERE source_key LIKE 'pmc_2026_opencity:%' AND (official_x_username <> '' OR x_verified_by_admin)`,
    ),
  };

  section('A. Connector parses the official CSV layout');
  {
    const rows = PMC2026.mapRows(parseCsv(FIXTURE_FULL));
    const w32 = rows.filter((r) => r.wardNumber === '32');
    step('A.1 four seats parsed', w32.length === 4, `n=${w32.length}`);
    step('A.2 gazette names parsed', w32[0].name === 'Bhosale Harshada Shantanu', w32[0].name);
    step('A.3 ward name on seat A', w32[0].wardName === 'Warje-Popular Nagar', w32[0].wardName);
    step('A.4 reservation parsed', w32[1].reservation === 'OBC', w32[1].reservation);
    step('A.5 party parsed', w32[0].party === 'BJP', w32[0].party);
    step('A.6 sources registry lists pmc_2026', listSources().some((s) => s.id === 'pmc_2026'), 'ok');
  }

  section('B. Ingest: idempotent import');
  let summary1;
  {
    summary1 = await runIngest('pmc_2026', { csvOverride: FIXTURE_FULL });
    step('B.1 two wards imported', summary1.summary.wards === 2, `wards=${summary1.summary.wards}`);
    step('B.2 eight representatives imported', summary1.summary.representatives === 8, `reps=${summary1.summary.representatives}`);
    const dup = await sql.sourceKeyDupes();
    step('B.3 no duplicate source keys', dup.rows.length === 0, `dupes=${dup.rows.length}`);
  }
  {
    const again = await runIngest('pmc_2026', { csvOverride: FIXTURE_FULL });
    const w32 = await sql.ward32Reps();
    const w99 = await sql.ward99Reps();
    const dup = await sql.sourceKeyDupes();
    step('B.4 re-run still 8 rows processed', again.summary.representatives === 8, `reps=${again.summary.representatives}`);
    step('B.5 Ward 32 still exactly 4 current reps', w32.rows.length === 4, `n=${w32.rows.length}`);
    step('B.6 Ward 99 still exactly 4 current reps', w99.rows.length === 4, `n=${w99.rows.length}`);
    step('B.7 no duplicate source keys after re-run', dup.rows.length === 0, `dupes=${dup.rows.length}`);
  }

  section('C. Adoption: Ward 32 uses its existing reps (never duplicated)');
  {
    const w32 = await sql.ward32Reps();
    const names = w32.rows.map((r) => r.name);
    step('C.1 names match the official gazette', [
      'Bhosale Harshada Shantanu', 'Barate Bharatbhushan Sharadchandra',
      'Vanjale Sayali Ramesh', 'Dodke Sachin Shivaji',
    ].every((n) => names.includes(n)), names.join(' | '));
    step('C.2 all four carry a source_key', w32.rows.every((r) => r.source_key === `pmc_2026_opencity:ward:Ward 32:seat:${r.seat}`), 'ok');
    step('C.3 all four party = BJP', w32.rows.every((r) => r.party === 'BJP'), 'ok');
    step('C.4 all four is_current', w32.rows.every((r) => r.is_current), 'ok');
    step('C.5 ward name upgraded to official', (await sql.ward32()).rows[0].ward_name === 'Warje-Popular Nagar', (await sql.ward32()).rows[0].ward_name);
  }

  section('D. No wrong person: never writes an X handle, never auto-verifies');
  {
    const w32 = await sql.ward32Reps();
    step('D.1 no X username on Ward 32 reps', w32.rows.every((r) => r.official_x_username === ''), 'ok');
    step('D.2 no admin verification on Ward 32 reps', w32.rows.every((r) => !r.x_verified_by_admin), 'ok');
    const withX = await sql.ingestedWithX();
    step('D.3 zero ingested reps have X handles or verification anywhere', withX.rows[0].n === 0, `n=${withX.rows[0].n}`);
  }

  section('E. Stale seats are demoted (not deleted) and can be re-adopted');
  {
    await runIngest('pmc_2026', { csvOverride: FIXTURE_MISSING_SEAT_D });
    const w99 = await sql.ward99Reps();
    step('E.1 Ward 99 now has 3 current reps', w99.rows.length === 3, `n=${w99.rows.length}`);
    step('E.2 seat D demoted, not deleted', (await sql.ward99Reps(false)).rows.some((r) => r.seat === 'D' && !r.is_current), 'ok');

    await runIngest('pmc_2026', { csvOverride: FIXTURE_FULL });
    const again = await sql.ward99Reps();
    step('E.3 seat D re-adopted as current', again.rows.length === 4 && again.rows.some((r) => r.seat === 'D' && r.is_current), `n=${again.rows.length}`);
  }

  section('F. Admin API: sources list + trigger a run');
  let adminToken = null;
  {
    const r = await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@civiceye.test', password: PASSWORD },
    });
    adminToken = r.data?.token;
    step('F.0 admin login', !!adminToken, 'ok');

    const src = await api(base, '/api/admin/ingest/sources', { token: adminToken });
    const hasPmc = (src.data?.sources || []).some((s) => s.id === 'pmc_2026');
    step('F.1 sources endpoint lists pmc_2026', hasPmc, `status=${src.status}`);

    const run = await api(base, '/api/admin/ingest/run', {
      method: 'POST',
      token: adminToken,
      body: { source: 'pmc_2026', csvOverride: FIXTURE_FULL },
    });
    step('F.2 admin can trigger an ingest run', run.status === 200 && run.data?.run?.status === 'ok', `status=${run.status} ${run.data?.run?.status}`);
    step('F.3 run summary recorded', run.data?.run?.summary?.wards === 2, `wards=${run.data?.run?.summary?.wards}`);
    const w32 = await sql.ward32Reps();
    step('F.4 still exactly 4 current Ward-32 reps after admin run', w32.rows.length === 4, `n=${w32.rows.length}`);
  }

  section('G. Resolution at Warje returns the four Ward-32 corporators');
  {
    const r = await api(base, '/api/representatives/resolve?lat=18.4786&lng=73.7987');
    const res = r.data || {};
    const names = (res.representatives || []).map((x) => x.name);
    const tokens = (n) => n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const has = (expected) => names.some((n) => { const own = tokens(n); return tokens(expected).every((t) => own.includes(t)); });
    step('G.1 resolution = PMC Ward 32', res.corporation?.code === 'PMC' && res.ward?.ward_number === 'Ward 32', `corp=${res.corporation?.code} ward=${res.ward?.ward_number}`);
    step('G.2 four corporators present', ['Harshada Bhosale', 'Bharatbhushan Barate', 'Sayali Vanjale', 'Sachin Dodke'].every(has), names.join(' | '));
    step('G.3 cannot escalate without verified X', res.canEscalate === false, `canEscalate=${res.canEscalate}`);
    step('G.4 official boundary provenance', res.source === 'official_boundary', `source=${res.source}`);
  }

  // Cleanup: remove the temporary fixture ward + its reps.
  await pool.query(
    `DELETE FROM representatives WHERE source_key LIKE 'pmc_2026_opencity:ward:Ward 99:%'`,
  );
  await pool.query(
    `DELETE FROM wards WHERE ward_number = 'Ward 99' AND corporation_id = (SELECT id FROM corporations WHERE code = 'PMC')`,
  );

  section('Summary');
  const fails = results.filter((x) => !x.ok);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${results.length - fails.length}/${results.length} steps passed`);
  if (fails.length) {
    console.log('FAILED steps:');
    for (const f of fails) console.log(`  - ${f.name}`);
  }
  console.log('='.repeat(60));
  return fails.length === 0 ? 0 : 1;
}

try {
  const code = await main();
  if (server) await new Promise((resolve) => server.close(resolve));
  process.exit(code);
} catch (err) {
  console.error('\nFATAL: test run crashed');
  console.error(err);
  if (server) await new Promise((resolve) => server.close(resolve));
  process.exit(1);
}
