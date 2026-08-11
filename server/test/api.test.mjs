// CivicEye API end-to-end test suite.
//
// Covers every step of the auth + RBAC + officer-management flow:
//   registration, login, session, role-based access control (citizen/officer/admin),
//   admin officer management, and public endpoints.
//
// Usage (from the server/ directory so .env is loaded):
//   node test/api.test.mjs            # self-hosts the API on an ephemeral port
//   TEST_BASE_URL=http://localhost:4000 node test/api.test.mjs   # target a running server
//
// Exits 0 if every step passes, 1 otherwise. Re-runnable (uses unique emails).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { env as nodeEnv } from 'node:process';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

const TEST_BASE_URL = nodeEnv.TEST_BASE_URL;
const PASSWORD = 'CivicEye@2026';

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------
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
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let server;
let base;

async function main() {
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

  const ADMIN = { email: 'admin@civiceye.test', password: PASSWORD };
  const OFFICER = { email: 'officer@civiceye.test', password: PASSWORD };

  // ----------------------------------------------------------------- SECTION 1: Registration
  section('1. Registration (always creates a citizen)');

  const citizenEmail = freshEmail('test.citizen');
  let r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Test Citizen', email: citizenEmail, password: PASSWORD },
  });
  step('1.1 register citizen -> 201', r.status === 201, `status=${r.status}`);
  step('1.2 citizen role forced to "citizen"', r.data?.user?.role === 'citizen', `role=${r.data?.user?.role}`);
  const citizenToken = r.data?.token;
  step('1.3 token issued', !!citizenToken, citizenToken ? 'ok' : 'missing');

  r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Spoofed Admin',
      email: freshEmail('test.spoof'),
      password: PASSWORD,
      role: 'admin',
      account_type: 'officer',
    },
  });
  step('1.4 role spoofing blocked (role ignored)', r.status === 201 && r.data?.user?.role === 'citizen', `status=${r.status} role=${r.data?.user?.role}`);

  r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Duplicate', email: citizenEmail, password: PASSWORD },
  });
  step('1.5 duplicate email -> 409', r.status === 409, `status=${r.status}`);

  r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Weak', email: freshEmail('test.weak'), password: '123' },
  });
  step('1.6 short password -> 400', r.status === 400, `status=${r.status}`);

  r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Bad Email', email: 'not-an-email', password: PASSWORD },
  });
  step('1.7 invalid email -> 400', r.status === 400, `status=${r.status}`);

  r = await api(base, '/api/auth/register', {
    method: 'POST',
    body: { email: freshEmail('test.noname'), password: PASSWORD },
  });
  step('1.8 missing name -> 400', r.status === 400, `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 2: Login
  section('2. Login');

  r = await api(base, '/api/auth/login', { method: 'POST', body: { email: citizenEmail, password: PASSWORD } });
  step('2.1 citizen login -> 200', r.status === 200 && r.data?.user?.role === 'citizen', `status=${r.status}`);

  r = await api(base, '/api/auth/login', { method: 'POST', body: OFFICER });
  step('2.2 officer login -> 200 (role=officer)', r.status === 200 && r.data?.user?.role === 'officer', `status=${r.status}`);
  const officerToken = r.data?.token;

  r = await api(base, '/api/auth/login', { method: 'POST', body: ADMIN });
  step('2.3 admin login -> 200 (role=admin)', r.status === 200 && r.data?.user?.role === 'admin', `status=${r.status}`);
  const adminToken = r.data?.token;

  r = await api(base, '/api/auth/login', { method: 'POST', body: { email: citizenEmail, password: 'WrongPass1!' } });
  step('2.4 wrong password -> 401 (generic message)', r.status === 401 && r.data?.error === 'Invalid email or password.', `status=${r.status} msg=${r.data?.error}`);

  r = await api(base, '/api/auth/login', { method: 'POST', body: { email: 'nobody@civiceye.test', password: PASSWORD } });
  step('2.5 unknown email -> 401 (generic message)', r.status === 401 && r.data?.error === 'Invalid email or password.', `status=${r.status} msg=${r.data?.error}`);

  r = await api(base, '/api/auth/login', { method: 'POST', body: { email: citizenEmail } });
  step('2.6 missing password -> 400', r.status === 400, `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 3: Session
  section('3. Session (/api/auth/me)');

  r = await api(base, '/api/auth/me', { token: citizenToken });
  step('3.1 me with valid token -> 200', r.status === 200 && r.data?.user?.email === citizenEmail, `status=${r.status}`);

  r = await api(base, '/api/auth/me');
  step('3.2 me without token -> 401', r.status === 401, `status=${r.status}`);

  r = await api(base, '/api/auth/me', { token: 'garbage.token.here' });
  step('3.3 me with bad token -> 401', r.status === 401, `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 4: RBAC — citizen
  section('4. RBAC: citizen cannot reach officer/admin');

  const citizenDenied = [
    ['4.1  GET  /api/admin/users', '/api/admin/users', 'GET'],
    ['4.2  GET  /api/admin/analytics', '/api/admin/analytics', 'GET'],
    ['4.3  POST /api/admin/officers', '/api/admin/officers', 'POST'],
    ['4.4  GET  /api/officer/issues', '/api/officer/issues', 'GET'],
    ['4.5  POST /api/officer/issues/00000000-0000-0000-0000-000000000000/assign', '/api/officer/issues/00000000-0000-0000-0000-000000000000/assign', 'POST'],
  ];
  for (const [name, path, method] of citizenDenied) {
    r = await api(base, path, { method, token: citizenToken, body: method === 'POST' ? {} : undefined });
    step(name, r.status === 403, `status=${r.status} (want 403)`);
  }

  // ----------------------------------------------------------------- SECTION 5: RBAC — officer
  section('5. RBAC: officer allowed on officer, denied on admin');

  r = await api(base, '/api/officer/stats', { token: officerToken });
  step('5.1 officer -> GET /api/officer/stats = 200', r.status === 200, `status=${r.status}`);

  r = await api(base, '/api/officer/issues', { token: officerToken });
  step('5.2 officer -> GET /api/officer/issues = 200', r.status === 200, `status=${r.status}`);

  r = await api(base, '/api/admin/users', { token: officerToken });
  step('5.3 officer -> GET /api/admin/users = 403', r.status === 403, `status=${r.status}`);

  r = await api(base, '/api/admin/analytics', { token: officerToken });
  step('5.4 officer -> GET /api/admin/analytics = 403', r.status === 403, `status=${r.status}`);

  r = await api(base, '/api/admin/officers', { method: 'POST', token: officerToken, body: {} });
  step('5.5 officer -> POST /api/admin/officers = 403', r.status === 403, `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 6: RBAC — admin
  section('6. RBAC: admin reaches admin + officer endpoints');

  r = await api(base, '/api/admin/users', { token: adminToken });
  step('6.1 admin -> GET /api/admin/users = 200', r.status === 200 && Array.isArray(r.data?.users), `status=${r.status}`);

  r = await api(base, '/api/admin/analytics', { token: adminToken });
  step('6.2 admin -> GET /api/admin/analytics = 200', r.status === 200, `status=${r.status}`);

  r = await api(base, '/api/officer/stats', { token: adminToken });
  step('6.3 admin -> GET /api/officer/stats = 200', r.status === 200, `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 7: RBAC — anonymous
  section('7. RBAC: anonymous is rejected');

  r = await api(base, '/api/admin/users');
  step('7.1 anonymous -> GET /api/admin/users = 401', r.status === 401, `status=${r.status}`);

  r = await api(base, '/api/officer/issues');
  step('7.2 anonymous -> GET /api/officer/issues = 401', r.status === 401, `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 8: Admin officer management
  section('8. Admin officer management');

  const officerEmail = freshEmail('officer.created');
  r = await api(base, '/api/admin/officers', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Created Officer', email: officerEmail, password: PASSWORD, is_active: true },
  });
  step('8.1 admin creates officer -> 201 (role=officer)', r.status === 201 && r.data?.officer?.role === 'officer', `status=${r.status} role=${r.data?.officer?.role}`);

  r = await api(base, '/api/admin/officers', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Duplicate Officer', email: officerEmail, password: PASSWORD },
  });
  step('8.2 duplicate officer email -> 409', r.status === 409, `status=${r.status}`);

  r = await api(base, '/api/admin/officers', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Weak Officer', email: freshEmail('officer.weak'), password: '123' },
  });
  step('8.3 weak officer password -> 400', r.status === 400, `status=${r.status}`);

  r = await api(base, '/api/admin/officers', { token: adminToken });
  step('8.4 list officers includes new one', r.status === 200 && Array.isArray(r.data?.officers) && r.data.officers.some((o) => o.email === officerEmail), `status=${r.status} count=${r.data?.officers?.length}`);

  r = await api(base, '/api/auth/login', { method: 'POST', body: { email: officerEmail, password: PASSWORD } });
  step('8.5 newly created officer can log in', r.status === 200 && r.data?.user?.role === 'officer', `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 9: Officer workflow
  section('9. Officer workflow (status change, update, assign, resolve + notify)');

  const cats = (await api(base, '/api/admin/categories', { token: adminToken })).data?.categories || [];
  const categoryId = cats.find((c) => c.is_active)?.id || cats[0]?.id;
  let newIssue = null;
  if (categoryId) {
    r = await api(base, '/api/issues', {
      method: 'POST',
      token: citizenToken,
      body: {
        categoryId,
        title: `Test issue ${Date.now()}`,
        description: 'Created by the automated test suite.',
        severity: 'MODERATE',
        lat: 18.5915,
        lng: 73.739,
        address: 'Test address',
        area: 'Hinjewadi Phase 1',
        city: 'Pune',
        imageIds: [],
      },
    });
    step('9.1 citizen creates a new issue', r.status === 201 && !!r.data?.issue?.id, `status=${r.status}`);
    newIssue = r.data?.issue || null;
  } else {
    step('9.1 citizen creates a new issue', false, 'no category available');
  }

  if (newIssue) {
    const fromStatus = newIssue.status;
    const next = fromStatus === 'VERIFIED' ? 'ASSIGNED' : 'VERIFIED';
    r = await api(base, `/api/officer/issues/${newIssue.id}/status`, {
      method: 'PATCH',
      token: officerToken,
      body: { toStatus: next, note: 'test status change' },
    });
    step('9.2 officer changes issue status', r.status === 200, `status=${r.status} (${fromStatus}->${next})`);

    r = await api(base, `/api/officer/issues/${newIssue.id}/update`, {
      method: 'POST',
      token: officerToken,
      body: { body: 'Official update from the automated test suite' },
    });
    step('9.3 officer posts official update', r.status === 201, `status=${r.status}`);

    r = await api(base, `/api/officer/issues/${newIssue.id}/assign`, {
      method: 'POST',
      token: officerToken,
      body: { note: 'test assignment' },
    });
    step('9.4 officer assigns the issue', r.status === 200, `status=${r.status}`);

    r = await api(base, `/api/issues/${newIssue.public_id}`);
    step('9.5 issue visible publicly after workflow', r.status === 200, `status=${r.status}`);

    let afterImageId = null;
    try {
      const { default: sharp } = await import('sharp');
      const png = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 30, g: 180, b: 90 } } })
        .png()
        .toBuffer();
      const fd = new FormData();
      fd.append('images', new Blob([png], { type: 'image/png' }), 'fixed.png');
      const upRes = await fetch(base + '/api/uploads/images', { method: 'POST', headers: { Authorization: `Bearer ${officerToken}` }, body: fd });
      const upBody = await upRes.json().catch(() => ({}));
      if (!upBody.uploads?.[0]?.id) console.log(`UPLOAD DIAG: status=${upRes.status} body=${JSON.stringify(upBody)}`);
      afterImageId = upBody.uploads?.[0]?.id;
    } catch (err) {
      console.log('UPLOAD THREW:', err?.message || err);
    }
    r = await api(base, `/api/officer/issues/${newIssue.id}/status`, {
      method: 'PATCH',
      token: officerToken,
      body: { toStatus: 'RESOLVED', note: 'test resolution', afterImageId },
    });
    step(
      '9.6 officer resolves issue with after-photo',
      afterImageId && r.status === 200,
      `status=${r.status} afterImageId=${afterImageId ? 'yes' : 'no'} err=${r.data?.error || ''}`,
    );

    if (r.status === 200) {
      r = await api(base, '/api/notifications', { token: citizenToken });
      const resolved = (r.data?.notifications || []).find(
        (n) => n.type === 'issue_resolved' && String(n.data?.issueId) === String(newIssue.id),
      );
      step('9.7 reporter receives resolution notification', !!resolved, resolved ? 'ok' : 'none found');
    } else {
      step('9.7 reporter receives resolution notification', false, 'skipped — resolve failed');
    }
  } else {
    step('9.2 officer changes issue status', false, 'skipped — no new issue');
    step('9.3 officer posts official update', false, 'skipped — no new issue');
    step('9.4 officer assigns the issue', false, 'skipped — no new issue');
    step('9.5 issue visible publicly after workflow', false, 'skipped — no new issue');
    step('9.6 officer resolves issue with after-photo', false, 'skipped — no new issue');
    step('9.7 reporter receives resolution notification', false, 'skipped — no new issue');
  }

  // ----------------------------------------------------------------- SECTION 10: Public endpoints
  section('10. Public endpoints');

  r = await api(base, '/api/issues');
  step('10.1 GET /api/issues -> 200 (list)', r.status === 200 && Array.isArray(r.data?.issues), `status=${r.status}`);
  const firstIssue = r.data?.issues?.[0];
  const publicId = firstIssue?.public_id ?? firstIssue?.id;

  if (publicId) {
    r = await api(base, `/api/issues/${publicId}`);
    step('10.2 GET /api/issues/:id -> 200 (detail)', r.status === 200, `status=${r.status}`);
  } else {
    step('10.2 GET /api/issues/:id -> 200 (detail)', false, 'no issues in list to fetch');
  }

  r = await api(base, '/api/city/stats');
  step('10.3 GET /api/city/stats -> 200', r.status === 200, `status=${r.status}`);

  r = await api(base, '/api/city/categories');
  step('10.4 GET /api/city/categories -> 200', r.status === 200, `status=${r.status}`);

  r = await api(base, '/api/locations');
  step('10.5 GET /api/locations -> 200 (localities)', r.status === 200 && Array.isArray(r.data?.locations), `status=${r.status} count=${r.data?.locations?.length}`);

  r = await api(base, '/api/auth/demo-accounts');
  step('10.6 GET /api/auth/demo-accounts -> 200 (dev only)', r.status === 200 && Array.isArray(r.data?.accounts), `status=${r.status}`);

  // ----------------------------------------------------------------- SECTION 11: Resolved issues + proof upload (admin)
  section('11. Admin resolved issues + resolution photo upload');

  r = await api(base, '/api/admin/resolved-issues', { token: adminToken });
  step('11.1 admin -> GET /api/admin/resolved-issues = 200', r.status === 200 && Array.isArray(r.data?.issues), `status=${r.status} count=${r.data?.issues?.length}`);

  r = await api(base, '/api/admin/resolved-issues', { token: officerToken });
  step('11.2 officer -> resolved-issues = 403', r.status === 403, `status=${r.status}`);

  const resolvedTarget = (await api(base, '/api/admin/resolved-issues', { token: adminToken })).data?.issues?.[0];
  if (resolvedTarget) {
    const { default: sharp } = await import('sharp');
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 220, g: 60, b: 40 } },
    }).png().toBuffer();
    const fd = new FormData();
    fd.append('images', new Blob([png], { type: 'image/png' }), 'proof.png');
    const upRes = await fetch(base + '/api/uploads/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: fd,
    }).then((res) => res.json());
    const imageId = upRes.uploads?.[0]?.id;
    step('11.3 admin uploads a proof image', !!imageId, imageId ? 'ok' : 'no upload returned');

    r = await api(base, `/api/admin/issues/${resolvedTarget.id}/resolution-photo`, {
      method: 'POST',
      token: adminToken,
      body: { imageId, note: 'test proof' },
    });
    step('11.4 attach resolution photo -> 201', imageId && r.status === 201, `status=${r.status}`);

    const afterList = (await api(base, '/api/admin/resolved-issues', { token: adminToken })).data?.issues || [];
    const updated = afterList.find((x) => x.id === resolvedTarget.id);
    step('11.5 list reflects the attached photo', updated?.after_url ? true : false, updated?.after_url ? `after_count=${updated.after_count}` : 'after_url missing');
  } else {
    step('11.3 admin uploads a proof image', false, 'no resolved issue to attach to');
    step('11.4 attach resolution photo -> 201', false, 'skipped — no target issue');
    step('11.5 list reflects the attached photo', false, 'skipped — no target issue');
  }

  // ----------------------------------------------------------------- Summary
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
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (global.__testPool) {
    await global.__testPool.end();
  }
  process.exit(code);
} catch (err) {
  console.error('\nFATAL: test run crashed');
  console.error(err);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (global.__testPool) await global.__testPool.end().catch(() => {});
  process.exit(1);
}
