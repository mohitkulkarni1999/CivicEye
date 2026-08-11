# CivicEye API Tests

End-to-end test suite covering authentication, authorization (RBAC), admin officer
management, and public endpoints.

## Quick start

```bash
# From the project root (auto-starts the API on an ephemeral port)
npm test

# Or from the server directory
cd server && npm test

# Run against a server that is already running (e.g. on port 4000)
TEST_BASE_URL=http://localhost:4000 node test/api.test.mjs
```

> The suite must run with `server/` as the working directory (or via `npm test`),
> because the server loads environment variables from `server/.env`.

## Development test accounts

Two accounts are created on a clean database (see `server/src/db/reset-data.js`)
so admin and officer can log in:

```
CivicEye@2026
```

| Email | Role | Notes |
|-------|------|-------|
| `officer@civiceye.test` | officer | Assigned to the Roads department |
| `admin@civiceye.test` | admin | Full admin access |

Citizen accounts are **not** seeded — register them from the signup page.

## What it does

- **Self-hosted by default** — imports the Express app, provisions the development
  test accounts (`admin@civiceye.test`, `officer@civiceye.test`), listens on a random
  port, runs all steps, then shuts down the server and DB pool.
- **Or targets a running server** via `TEST_BASE_URL` (e.g. `npm run dev` + `TEST_BASE_URL=http://localhost:4000 node test/api.test.mjs`).
- **Re-runnable** — every test user uses a unique email (timestamp-suffixed), so
  nothing collides on repeat runs.
- **CI-friendly** — prints `PASS`/`FAIL` per step and exits `0` if all steps pass,
  `1` if any fail.

## The 11 test sections

| # | Section | What is verified |
|---|---------|------------------|
| 1 | Registration | Registering always creates a **citizen**. `role`/`account_type` are ignored (role spoofing blocked). Duplicate email → 409. Short password, invalid email, missing name → 400. |
| 2 | Login | Citizen, officer, and admin logins succeed with the correct role. Wrong password and unknown email both → 401 with the generic `Invalid email or password.` message. Missing fields → 400. |
| 3 | Session | `/api/auth/me` returns the user for a valid token; rejects missing and malformed tokens with 401. |
| 4 | RBAC: citizen | A citizen token is denied (403) on admin routes (`/api/admin/users`, `/api/admin/analytics`, `/api/admin/officers`) and officer routes (`/api/officer/issues`, issue assign). |
| 5 | RBAC: officer | An officer can use officer routes (`/api/officer/stats`, `/api/officer/issues`) but is denied (403) on all admin routes. |
| 6 | RBAC: admin | An admin can access admin routes and officer routes (both 200). |
| 7 | RBAC: anonymous | No token → 401 on protected admin and officer routes. |
| 8 | Officer management | Admin creates an officer (201, role `officer`), duplicate email → 409, weak password → 400, the new officer appears in the list, and can log in. |
| 9 | Officer workflow | Creates a fresh issue as the citizen, then the officer changes its status (`PATCH /api/officer/issues/:id/status`), posts an official update (`POST .../update`), assigns it (`POST .../assign`), and resolves it with an uploaded after-photo — all succeed. The reporter then has an `issue_resolved` notification (`GET /api/notifications`). |
| 10 | Public endpoints | `/api/issues` list + detail, `/api/city/stats`, `/api/city/categories`, `/api/locations`, and `/api/auth/demo-accounts` all return 200. |
| 11 | Resolved issues + proof upload | Admin lists resolved issues (last reported first), uploads a photo via `/api/uploads/images`, attaches it as a resolution ("after") photo to the last reported issue, and confirms it shows up. Non-admins are denied (403). |

## Adding a step

Add a `step(...)` call inside `main()` in `test/api.test.mjs`, anywhere after the
`base` URL is set:

```js
r = await api(base, '/api/issues', { token: adminToken });
step('my new check', r.status === 200 && Array.isArray(r.data?.issues), `status=${r.status}`);
```

The `api()` helper handles JSON bodies, auth headers, and returns `{ status, data }`.

## Related files

- `server/test/api.test.mjs` — the test suite
- `server/src/db/seed.js` — `ensureDevAccounts()` (exported for the test to self-provision `*@civiceye.test` accounts)
- `server/package.json` — `npm test`
- `package.json` (root) — `npm test` / `npm run test:api`
