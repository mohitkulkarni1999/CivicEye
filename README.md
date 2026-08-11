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

## Tests

```bash
npm test                      # end-to-end API suite (self-hosted)
TEST_BASE_URL=http://localhost:4000 npm --prefix server run test
```

See `server/test/README.md` for details.

## Project layout

- `server/` — Express API, migrations, tests
- `client/` — React (Vite) frontend
