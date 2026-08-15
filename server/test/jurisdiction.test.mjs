// CivicEye jurisdiction test suite.
//
// Verifies that a map point resolves to the correct MUNICIPAL CORPORATION and
// ward — never a cross-corporation representative:
//   A. Warje (PMC)        -> PMC Ward 32 (Warje-Popularnagar), the four 2026
//                            elected corporators — and NEVER Karve Nagar's
//                            Ward 10 / Neeta Gupte.
//   B. Kothrud (PMC)      -> PMC ward (never PCMC)
//   C. Shivajinagar (PMC) -> PMC ward
//   D. Pimpri (PCMC)      -> PCMC ward (never PMC)
//   E. boundary point     -> WARD_AMBIGUOUS (refuse to guess)
//   F. cross-corporation  -> CORPORATION_MISMATCH (point inside a PMC ward AND
//                            a PCMC ward must never pick either)
//   G. missing GPS        -> 400 (LOCATION_REQUIRED_FOR_REPRESENTATIVE_RESOLUTION)
//   H. admin plumbing     -> corporations list + escalation tag rule default
//   I. end-to-end issue   -> issue at Warje stores PMC / Ward 32 / official
//                            boundary provenance and officer_name = primary rep
//
// Usage (from the server/ directory so .env is loaded):
//   node test/jurisdiction.test.mjs
//   TEST_BASE_URL=http://localhost:4000 node test/jurisdiction.test.mjs
//
// Exits 0 if every step passes, 1 otherwise. Re-runnable.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { env as nodeEnv } from 'node:process';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

const TEST_BASE_URL = nodeEnv.TEST_BASE_URL;
const PASSWORD = 'CivicEye@2026';

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
    /* non-JSON body */
  }
  return { status: res.status, data };
}

function freshEmail(prefix) {
  return `${prefix}.${Date.now()}@civiceye.test`;
}

const POINTS = {
  warjeCentre: { lat: 18.4786, lng: 73.7987, area: 'Warje', city: 'Pune' },
  warjeNdaRoad: { lat: 18.47857, lng: 73.79875 },
  kothrud: { lat: 18.5074, lng: 73.8077 },
  shivajinagar: { lat: 18.5308, lng: 73.8474 },
  pimpri: { lat: 18.6172, lng: 73.8069 },
  warjeKarveBoundary: { lat: 18.487, lng: 73.812 }, // inside both Ward 32 + Karve Nagar
};

let server;

async function main() {
  let base;

  if (TEST_BASE_URL) {
    base = TEST_BASE_URL;
    console.log(`Targeting running server at ${base}`);
  } else {
    const { app } = await import(pathToFileURL(join(srcDir, 'app.js')).href);
    const { ensureDevAccounts } = await import(pathToFileURL(join(srcDir, 'db', 'seed.js')).href);
    const { pool } = await import(pathToFileURL(join(srcDir, 'config', 'db.js')).href);
    await ensureDevAccounts();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://localhost:${server.address().port}`;
    global.__testPool = pool;
    console.log(`Started self-hosted API at ${base}`);
  }
  const { pool } = await import(pathToFileURL(join(srcDir, 'config', 'db.js')).href);

  section('A. Warje -> PMC Ward 32 (never PCMC / Ward 10 / Neeta Gupte)');
  for (const [label, pt] of [
    ['Warje centre', POINTS.warjeCentre],
    ['Warje NDA Road', POINTS.warjeNdaRoad],
  ]) {
    const r = await api(base, `/api/representatives/resolve?lat=${pt.lat}&lng=${pt.lng}`);
    const res = r.data || {};
    const repNames = (res.representatives || []).map((x) => x.name);
    step(`A.${label} -> corporation PMC`, r.status === 200 && res.corporation?.code === 'PMC', `corp=${res.corporation?.code} reason=${res.reason}`);
    step(`A.${label} -> ward number 32`, res.ward?.ward_number === 'Ward 32', `ward=${res.ward?.ward_number}`);
    step(`A.${label} -> ward name Warje`, (res.ward?.ward_name || '').toLowerCase().includes('warje'), `name=${res.ward?.ward_name}`);
    step(`A.${label} -> never Ward 10`, res.ward?.ward_number !== 'Ward 10', 'ok');
    step(`A.${label} -> never Neeta Gupte`, !repNames.includes('Neeta Gupte'), repNames.join(', '));
    step(`A.${label} -> 2026 corporators present`, ['Harshada Bhosale', 'Bharatbhushan Barate', 'Sayali Wanjale', 'Sachin Dodke'].every((n) => repNames.includes(n)), `n=${repNames.length}`);
    step(`A.${label} -> official boundary source`, res.source === 'official_boundary', `source=${res.source}`);
    step(`A.${label} -> high confidence`, res.confidence === 'high', `conf=${res.confidence}`);
  }

  section('B. Kothrud -> PMC (never PCMC)');
  {
    const r = await api(base, `/api/representatives/resolve?lat=${POINTS.kothrud.lat}&lng=${POINTS.kothrud.lng}`);
    const res = r.data || {};
    step('B. Kothrud corporation = PMC', res.corporation?.code === 'PMC', `corp=${res.corporation?.code} reason=${res.reason}`);
    step('B. Kothrud ward found', !!res.ward?.ward_number, `ward=${res.ward?.ward_number}`);
  }

  section('C. Shivajinagar -> PMC (never PCMC)');
  {
    const r = await api(base, `/api/representatives/resolve?lat=${POINTS.shivajinagar.lat}&lng=${POINTS.shivajinagar.lng}`);
    const res = r.data || {};
    step('C. Shivajinagar corporation = PMC', res.corporation?.code === 'PMC', `corp=${res.corporation?.code}`);
    step('C. Shivajinagar ward found', !!res.ward?.ward_number, `ward=${res.ward?.ward_number}`);
  }

  section('D. Pimpri -> PCMC (never PMC)');
  {
    const r = await api(base, `/api/representatives/resolve?lat=${POINTS.pimpri.lat}&lng=${POINTS.pimpri.lng}`);
    const res = r.data || {};
    step('D. Pimpri corporation = PCMC', res.corporation?.code === 'PCMC', `corp=${res.corporation?.code} reason=${res.reason}`);
    step('D. Pimpri ward found', !!res.ward?.ward_number, `ward=${res.ward?.ward_number}`);
  }

  section('E. Boundary point -> WARD_AMBIGUOUS (refuse to guess)');
  {
    const r = await api(base, `/api/representatives/resolve?lat=${POINTS.warjeKarveBoundary.lat}&lng=${POINTS.warjeKarveBoundary.lng}`);
    const res = r.data || {};
    step('E. boundary point refuses to guess', res.reason === 'WARD_AMBIGUOUS' && res.matched === false, `reason=${res.reason}`);
  }

  section('F. Cross-corporation -> CORPORATION_MISMATCH');
  let tmpWardId = null;
  {
    // A point can never legally be in both PMC and PCMC. Insert a temporary PCMC
    // ward whose polygon covers Warje centre, then the resolver must refuse.
    const w = await pool.query(
      `INSERT INTO wards (city, ward_number, ward_name, corporation_id, source)
       SELECT 'Pune', 'TMP-CROSS', 'Temp PCMC ward for test', id, 'test'
         FROM corporations WHERE code = 'PCMC' RETURNING id`,
    );
    tmpWardId = w.rows[0].id;
    const ring = [
      [18.47, 73.79], [18.47, 73.81], [18.487, 73.81], [18.487, 73.79],
    ];
    for (let i = 0; i < ring.length; i++) {
      const [lat, lng] = ring[i];
      const [lat2, lng2] = ring[(i + 1) % ring.length];
      await pool.query(
        `INSERT INTO ward_boundaries (ward_id, ring_idx, seq, lat, lng)
         VALUES ($1, 0, $2, $3, $4)`,
        [tmpWardId, i, lat, lng],
      );
      await pool.query(
        `INSERT INTO ward_boundaries (ward_id, ring_idx, seq, lat, lng)
         VALUES ($1, 0, $2, $3, $4)`,
        [tmpWardId, 100 + i, lat2, lng2],
      );
    }
    const r = await api(base, `/api/representatives/resolve?lat=${POINTS.warjeCentre.lat}&lng=${POINTS.warjeCentre.lng}`);
    const res = r.data || {};
    step('F. overlapping PMC+PCMC ward refused', res.reason === 'CORPORATION_MISMATCH' && res.matched === false, `reason=${res.reason}`);
  }
  if (tmpWardId) {
    await pool.query('DELETE FROM wards WHERE id = $1', [tmpWardId]);
    tmpWardId = null;
  }

  section('G. Missing GPS -> 400');
  {
    const r = await api(base, '/api/representatives/resolve');
    step('G. no lat/lng rejected', r.status === 400, `status=${r.status}`);
  }

  section('H. Admin plumbing (corporations + tag rule)');
  let adminToken = null;
  {
    const r = await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@civiceye.test', password: PASSWORD },
    });
    adminToken = r.data?.token;
    step('H.0 admin login', !!adminToken, 'ok');

    const corp = await api(base, '/api/admin/corporations', { token: adminToken });
    const codes = (corp.data?.corporations || []).map((c) => c.code);
    step('H.1 corporations list has PMC', codes.includes('PMC'), codes.join(','));
    step('H.2 corporations list has PCMC', codes.includes('PCMC'), codes.join(','));

    const rule = await api(base, '/api/admin/settings/escalation-tag-rule', { token: adminToken });
    step('H.3 tag rule defaults to TAG_SELECTED_REPRESENTATIVE', rule.data?.value === 'TAG_SELECTED_REPRESENTATIVE', `value=${rule.data?.value}`);
    const setAll = await api(base, '/api/admin/settings/escalation-tag-rule', {
      method: 'PUT',
      token: adminToken,
      body: { value: 'TAG_ALL_WARD_REPRESENTATIVES' },
    });
    step('H.4 tag rule can be set to TAG_ALL', setAll.data?.value === 'TAG_ALL_WARD_REPRESENTATIVES', `value=${setAll.data?.value}`);
    await api(base, '/api/admin/settings/escalation-tag-rule', {
      method: 'PUT',
      token: adminToken,
      body: { value: 'TAG_SELECTED_REPRESENTATIVE' },
    });

    const wards = await api(base, '/api/admin/wards', { token: adminToken });
    const w32 = (wards.data?.wards || []).find((x) => x.ward_number === 'Ward 32' && x.city === 'Pune');
    step('H.5 Ward 32 exists with corporation PMC', w32?.corporation_code === 'PMC', `corp=${w32?.corporation_code}`);
    step('H.6 Ward 32 has 4 current representatives', w32?.representative_count === 4, `count=${w32?.representative_count}`);

    const reps = await api(base, '/api/admin/representatives', { token: adminToken });
    const w32Rep = (reps.data?.representatives || []).find((x) => x.name === 'Harshada Bhosale');
    step('H.7 rep carries party/seat', w32Rep?.party === 'BJP' && w32Rep?.seat === 'A', `party=${w32Rep?.party} seat=${w32Rep?.seat}`);
    step('H.8 rep linked to Ward 32', Array.isArray(w32Rep?.wards) && w32Rep.wards.some((x) => x.ward_number === 'Ward 32'), 'ok');
  }

  section('I. End-to-end issue at Warje stores the correct jurisdiction');
  {
    const cat = await api(base, '/api/admin/categories', { token: adminToken });
    const pothole = cat.data?.categories?.find((c) => c.slug === 'pothole');
    const email = freshEmail('juri.citizen');
    const reg = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Jurisdiction Citizen', email, password: PASSWORD },
    });
    const token = reg.data?.token;
    step('I.1 citizen registered', !!token, 'ok');

    const r = await api(base, '/api/issues', {
      method: 'POST',
      token,
      body: {
        categoryId: pothole?.id,
        title: 'Deep pothole at Warje NDA Road',
        description: 'A very large pothole near the gate',
        severity: 'HIGH',
        lat: POINTS.warjeNdaRoad.lat,
        lng: POINTS.warjeNdaRoad.lng,
        area: 'Warje',
        city: 'Pune',
      },
    });
    const issue = r.data?.issue;
    step('I.2 issue created', r.status === 201 && !!issue, `status=${r.status}`);
    step('I.3 issue corporation = PMC', issue?.corporation_id && !!issue?.corporation_id, 'set');
    step('I.4 issue ward_id set', !!issue?.ward_id, 'set');
    step('I.5 resolution_source = official_boundary', issue?.resolution_source === 'official_boundary', `source=${issue?.resolution_source}`);
    step('I.6 issue ward_no = Ward 32', issue?.ward_no === 'Ward 32', `ward_no=${issue?.ward_no}`);
    step('I.7 officer_name = verified rep (not locality officer)', issue?.officer_name === 'Harshada Bhosale', `officer=${issue?.officer_name}`);

    const detail = await api(base, `/api/issues/${issue?.public_id}`);
    const d = detail.data?.issue;
    step('I.8 detail corporation = PMC', d?.corporation?.code === 'PMC', `code=${d?.corporation?.code}`);
    step('I.9 detail representatives include all 4', d?.representatives?.length === 4, `n=${d?.representatives?.length}`);
    step('I.10 detail ward = Ward 32', d?.ward?.ward_number === 'Ward 32', `ward=${d?.ward?.ward_number}`);
  }

  // Cleanup: remove the temporary cross-corporation ward.
  if (tmpWardId) {
    await pool.query('DELETE FROM wards WHERE id = $1', [tmpWardId]);
  }

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
  if (global.__testPool) await global.__testPool.end();
  process.exit(code);
} catch (err) {
  console.error('\nFATAL: test run crashed');
  console.error(err);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (global.__testPool) await global.__testPool.end().catch(() => {});
  process.exit(1);
}
