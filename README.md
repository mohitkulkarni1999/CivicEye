# CivicEye

AI-powered civic issue reporting and accountability platform. Citizens report
issues (e.g. potholes, broken streetlights), the AI analyses them, departments
triage and resolve them, and the whole process is public and auditable.

## Tech stack

- **Backend** — Node.js (Express), PostgreSQL, JWT auth, Sharp image pipeline
- **Frontend** — React (Vite), Tailwind
- **AI** — image analysis, repair verification, triage suggestions and digests
  (OpenAI by default, with an offline heuristic fallback)

## Setup

1. **PostgreSQL** — create a database (the default config in `server/.env` uses
   `civiceye`):

   ```sql
   CREATE DATABASE civiceye;
   ```

2. **Install dependencies**

   ```bash
   npm run setup
   ```

3. **Configure environment** — copy/edit `server/.env` (database URL, JWT secret,
   AI provider/key). Demo seeding is disabled by default (`DEMO_MODE=false`).

4. **Run the database migrations** (run from `server/`):

   ```bash
   npm run db:migrate
   ```

5. **Start**

   ```bash
   npm run dev            # backend (:4000) + frontend (:5173)
   ```

## Login credentials

Only admin and officer accounts are provisioned. **Citizen accounts are not
seeded** — register them from the signup page.

| Email                  | Role    | Password         |
|------------------------|---------|------------------|
| `admin@civiceye.test`  | admin   | `CivicEye@2026`  |
| `officer@civiceye.test`| officer | `CivicEye@2026`  |

## Data & demo seeding

- **No demo data is shipped.** All seeded issues, comments, votes and demo
  accounts have been removed.
- The "reseed demo database" admin action and the `/api/admin/seed` endpoint
  have been removed; `seedDatabase` refuses to run unless `DEMO_MODE=true`.
- To wipe all user-generated data while keeping reference data (departments,
  categories, locations) and the admin/officer accounts, run from `server/`:

  ```bash
  node src/db/reset-data.js
  ```

- **Wards** are seeded idempotently from the locality data (one ward per
  `(city, ward_no)`), and demo representatives are seeded **only** when
  `DEMO_MODE=true` (clearly marked, with no X usernames).

## Elected representative & X escalation

When a report is created, the platform deterministically resolves the current
elected representative (Nagar Sevak / Corporator) for that location —
**no AI guessing, no fake handles**:

1. Locality nearest to the report point (within its radius) is found.
2. That locality is mapped to a **ward** (via `boundary_locality_id`, else
   `city + ward_no`).
3. The ward's **current representative** (`is_current = true`) is attached to
   the issue and shown on the report page.
4. If the representative's X account has been **admin-verified**
   (`x_verified_by_admin` + username), an escalation is drafted (`READY`).

Ambiguity guard: if a different active ward is within a 150 m margin the system
refuses to guess (`WARD_AMBIGUOUS`) rather than risk mis-attributing.

### Escalation lifecycle

```
PENDING → READY → APPROVED → PUBLISHED / REJECTED / FAILED
```

- **Publishing is manual-only** (no X API credentials required): approved posts
  are shared through the `x.com/intent/tweet` composer or copied by the citizen
  from the issue page.
- Generated posts are sanitized (URLs, emails, phones, `@mentions` and
  hashtags are stripped from citizen text) and capped at 280 characters.
- A `resolution` post is drafted automatically when an issue is resolved and
  its report post was actually published.
- Admins manage representatives, wards and escalations under **Admin → 
  Representatives** and **Admin → X Escalations**; officers can approve
  escalations for their own department.
- Every action is recorded in the `audit_logs` table.

Environment (all optional, commented in `server/.env.example`):
`X_INTEGRATION_ENABLED=false`, `AUTO_X_POST=false` — reserved for a future
X API integration; publishing always goes through the manual composer today.

## Tests

```bash
npm test                      # end-to-end API suite (self-hosted)
TEST_BASE_URL=http://localhost:4000 npm --prefix server run test
```

See `server/test/README.md` for details.

## Project layout

- `server/` — Express API, migrations, tests
- `client/` — React (Vite) frontend
