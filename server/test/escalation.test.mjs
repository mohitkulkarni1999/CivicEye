// CivicEye X-escalation end-to-end test suite.
//
// Covers the elected-representative pipeline:
//   representative CRUD + X verification, ward linking, public resolution,
//   automatic escalation creation on issue report, sanitized post generation,
//   approve -> publish / reject lifecycle, and officer department scoping.
//
// Usage (from the server/ directory so .env is loaded):
//   node test/escalation.test.mjs            # self-hosts the API
//   TEST_BASE_URL=http://localhost:4000 node test/escalation.test.mjs
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

  // ------------------------------------------------------------ Login as admin
  section('1. Admin setup');
  let r = await api(base, '/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@civiceye.test', password: PASSWORD },
  });
  const adminToken = r.data?.token;
  step('1.1 admin login', !!adminToken, adminToken ? 'ok' : 'no token');

  r = await api(base, '/api/auth/login', {
    method: 'POST',
    body: { email: 'officer@civiceye.test', password: PASSWORD },
  });
  const officerToken = r.data?.token;
  step('1.2 officer login', !!officerToken, officerToken ? 'ok' : 'no token');

  // ------------------------------------------------- Create + verify a rep
  const REP_NAME = `Test Rep ${Date.now()}`;
  r = await api(base, '/api/admin/representatives', {
    method: 'POST',
    token: adminToken,
    body: {
      name: REP_NAME,
      designation: 'Nagar Sevak (Corporator)',
      constituency: 'Wakad',
      official_x_username: 'testcivicrep',
      data_source: 'test',
      notes: 'automated test representative',
    },
  });
  const rep = r.data?.representative;
  step('2.1 admin creates representative -> 201', r.status === 201 && !!rep, `status=${r.status}`);
  step('2.2 username normalized (no @)', rep?.official_x_username === 'testcivicrep', `got=${rep?.official_x_username}`);
  step('2.3 unverified by default', rep?.x_verified_by_admin === false, `verified=${rep?.x_verified_by_admin}`);

  r = await api(base, `/api/admin/representatives/${rep?.id}/verify-x`, {
    method: 'POST',
    token: adminToken,
    body: { verified: true },
  });
  step('2.4 admin verifies X account', r.data?.representative?.x_verified_by_admin === true, `verified=${r.data?.representative?.x_verified_by_admin}`);
  step('2.5 verification timestamp set', !!r.data?.representative?.last_verified_at, r.data?.representative?.last_verified_at || 'missing');

  // ----------------------------------------------------- Link rep to a ward
  section('3. Ward linking + public resolution');
  const wardsRes = await api(base, '/api/admin/wards', { token: adminToken });
  const ward = wardsRes.data?.wards?.find((w) => w.ward_number === 'Ward 21' && w.city === 'Pimpri-Chinchwad');
  step('3.1 wards list available', !!ward, ward ? `ward=${ward.ward_number}` : 'ward not found');

  r = await api(base, `/api/admin/wards/${ward?.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { representativeId: rep?.id },
  });
  step('3.2 ward linked to representative', r.data?.ward?.representative_id === rep?.id, `status=${r.status}`);

  // Wakad centre (must resolve inside its own radius and unambiguously)
  const WAKAD = { lat: 18.5971, lng: 73.7767 };
  r = await api(base, `/api/representatives/resolve?lat=${WAKAD.lat}&lng=${WAKAD.lng}`);
  const resolved = r.data;
  step('3.3 public resolve -> matched', resolved?.matched === true && resolved?.representative?.id === rep?.id, `reason=${resolved?.reason}`);
  step('3.4 public resolve -> canEscalate', resolved?.canEscalate === true, `canEscalate=${resolved?.canEscalate}`);
  step('3.5 resolve rejects bad coords', (await api(base, '/api/representatives/resolve?lat=999&lng=abc')).status === 400, 'status=400');

  // --------------------------------------------------- Report + escalation
  section('4. Automatic escalation on report');
  const catRes = await api(base, '/api/admin/categories', { token: adminToken });
  const pothole = catRes.data?.categories?.find((c) => c.slug === 'pothole');
  const waterCat = catRes.data?.categories?.find((c) => c.slug === 'water-leakage');
  step('4.0 categories available', !!pothole && !!waterCat, pothole ? `pothole=${pothole.id}` : 'missing');

  const citizenEmail = freshEmail('esc.citizen');
  r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Escalation Citizen', email: citizenEmail, password: PASSWORD },
  });
  const citizenToken = r.data?.token;
  step('4.1 citizen registered', !!citizenToken, citizenToken ? 'ok' : 'no token');

  // Deliberately dirty title to prove sanitization.
  const dirtyTitle = 'Huge pothole @somenoob near the gate';
  const dirtyDesc = 'Call me on 9850011201 or mail me@x.com more at https://evil.example/spam now';
  r = await api(base, '/api/issues', {
    method: 'POST',
    token: citizenToken,
    body: {
      categoryId: pothole?.id,
      title: dirtyTitle,
      description: dirtyDesc,
      severity: 'HIGH',
      lat: WAKAD.lat,
      lng: WAKAD.lng,
      area: 'Wakad',
      city: 'Pimpri-Chinchwad',
    },
  });
  const issue = r.data?.issue;
  const esc = r.data?.escalation;
  step('4.2 issue created', r.status === 201 && !!issue, `status=${r.status}`);
  step('4.3 escalation auto-created', !!esc, esc ? `status=${esc.status}` : 'missing');
  step('4.4 escalation READY (X verified)', esc?.status === 'READY', `status=${esc?.status}`);
  step('4.5 representative returned with issue', r.data?.representative?.id === rep?.id, `id=${r.data?.representative?.id}`);
  step('4.6 representative_id saved on issue', issue?.representative_id === rep?.id, `saved=${issue?.representative_id}`);

  const text = esc?.generated_text || '';
  step('4.7 @mention stripped from citizen text', !text.includes('@somenoob'), text ? 'ok' : 'no text');
  step('4.8 URL stripped from citizen text', !text.includes('evil.example'), 'ok');
  step('4.9 phone number stripped from citizen text', !text.includes('9850011201'), 'ok');
  step('4.10 email stripped from citizen text', !text.includes('me@x.com'), 'ok');
  step('4.11 verified rep @mentioned', text.includes('@testcivicrep'), 'ok');
  step('4.12 fits 280 chars', (text.length <= 280), `len=${text.length}`);
  step('4.13 includes issue link', text.includes('/issue/'), 'ok');

  r = await api(base, `/api/issues/${issue?.public_id}`);
  const detail = r.data?.issue;
  step('4.14 detail includes representative', detail?.representative?.id === rep?.id, `id=${detail?.representative?.id}`);
  step('4.15 detail includes escalations', detail?.escalations?.some((e) => e.id === esc?.id), `n=${detail?.escalations?.length}`);

  // ---------------------------------------------------------- Approve/publish
  section('5. Approve -> publish lifecycle');
  r = await api(base, `/api/admin/escalations/${esc?.id}/approve`, { method: 'POST', token: adminToken });
  step('5.1 admin approves escalation', r.data?.escalation?.status === 'APPROVED', `status=${r.data?.escalation?.status}`);
  step('5.2 share URL returned', (r.data?.shareUrl || '').startsWith('https://x.com/intent/tweet'), r.data?.shareUrl || 'missing');

  r = await api(base, `/api/admin/escalations/${esc?.id}/publish`, {
    method: 'POST',
    token: adminToken,
    body: { postUrl: 'https://x.com/civiceye/status/999999999999' },
  });
  step('5.3 admin marks published', r.data?.escalation?.status === 'PUBLISHED', `status=${r.data?.escalation?.status}`);
  step('5.4 post URL recorded', r.data?.escalation?.external_post_url?.includes('999999999999'), r.data?.escalation?.external_post_url || 'missing');
  step('5.5 published_at recorded', !!r.data?.escalation?.published_at, 'ok');

  // ------------------------------------------------ Reject lifecycle + scope
  section('6. Reject lifecycle + officer scoping');
  r = await api(base, '/api/issues', {
    method: 'POST',
    token: citizenToken,
    body: {
      categoryId: pothole?.id,
      title: 'Another test pothole for rejection',
      lat: WAKAD.lat,
      lng: WAKAD.lng,
      area: 'Wakad',
      city: 'Pimpri-Chinchwad',
    },
  });
  const issue2 = r.data?.issue;
  const esc2 = r.data?.escalation;
  step('6.1 second issue created', !!issue2 && !!esc2, esc2 ? `status=${esc2.status}` : 'missing');

  r = await api(base, `/api/admin/escalations/${esc2?.id}/reject`, {
    method: 'POST',
    token: adminToken,
    body: { reason: 'Needs more evidence' },
  });
  step('6.2 admin rejects escalation', r.data?.escalation?.status === 'REJECTED', `status=${r.data?.escalation?.status}`);
  step('6.3 reject reason recorded', r.data?.escalation?.failure_reason === 'Needs more evidence', r.data?.escalation?.failure_reason || 'empty');

  // Water issue -> officer (roads dept) must be blocked
  r = await api(base, '/api/issues', {
    method: 'POST',
    token: citizenToken,
    body: {
      categoryId: waterCat?.id,
      title: 'Water leak near wakad for scoping test',
      lat: WAKAD.lat,
      lng: WAKAD.lng,
      area: 'Wakad',
      city: 'Pimpri-Chinchwad',
    },
  });
  const esc3 = r.data?.escalation;
  step('6.4 water issue escalation created', !!esc3, esc3 ? `status=${esc3.status}` : 'missing');

  r = await api(base, `/api/officer/escalations/${esc3?.id}/approve`, { method: 'POST', token: officerToken });
  step('6.5 officer from other dept blocked (403)', r.status === 403, `status=${r.status}`);

  r = await api(base, `/api/admin/escalations/${esc3?.id}/approve`, { method: 'POST', token: adminToken });
  step('6.6 admin can approve cross-department', r.data?.escalation?.status === 'APPROVED', `status=${r.data?.escalation?.status}`);

  r = await api(base, '/api/admin/escalations?status=APPROVED', { token: adminToken });
  step('6.7 escalation list filters by status', Array.isArray(r.data?.escalations) && r.data.escalations.every((e) => e.status === 'APPROVED'), `n=${r.data?.escalations?.length}`);

  // ---------------------------------------------- Audit trail + summary
  section('7. Summary');
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
