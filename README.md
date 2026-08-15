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
  `(city, ward_no)`, with a boundary ring generated from the locality radius),
  and demo representatives are seeded **only** when `DEMO_MODE=true` (clearly
  marked, with no X usernames).
- PMC **Ward 32 (Warje-Popularnagar)** is seeded with its official 2026 election
  boundary polygon and the four elected corporators (Harshada Bhosale,
  Bharatbhushan Barate, Sayali Wanjale, Sachin Dodke — verified via election
  coverage, `data_source = 'pune_2026_election'`, no X handles until the admin
  adds and verifies them). Warje points therefore resolve to **PMC Ward 32** —
  never to the neighbouring Karve Nagar ward. Ward boundaries are managed under
  **Admin → Representatives** (paste rings or GeoJSON).

## Elected representative & X escalation

When a report is created, the platform deterministically resolves the current
elected representative(s) (Nagar Sevak / Corporator) for that location —
**no AI guessing, no fake handles**:

1. The report point is tested against official **ward boundary polygons**
   (pure-SQL ray casting over `ward_boundaries` ring points — no PostGIS
   required). The point resolves to the enclosing ward + **municipal
   corporation** (PMC / PCMC / …).
2. If no polygon contains the point, a fallback uses the nearest locality
   within its radius, mapped via `boundary_locality_id` (else `city + ward_no`).
3. The ward's **current representatives** (`ward_representatives` join, filtered
   to `is_current = true`) are attached to the issue; the primary one (ward's
   `representative_id`) is set as `officer_name` on the issue.
4. If the representatives' X accounts have been **admin-verified**
   (`x_verified_by_admin` + username), an escalation is drafted (`READY`).

Guards — the system **refuses to guess** rather than risk mis-attribution:

- **`WARD_AMBIGUOUS`** — the point falls inside more than one ward of the same
  corporation (overlapping seed boundaries) or within a 150 m margin of another
  active ward.
- **`CORPORATION_MISMATCH`** — the point falls inside wards of different
  corporations (e.g. a PMC polygon and a PCMC polygon overlap). This is
  jurisdictionally impossible, so it is never auto-picked.
- Representatives without an admin-verified X account resolve cleanly
  (`X_NOT_VERIFIED`) but never auto-escalate.

### Who gets @mentioned on X

Admin-configurable under **Admin → Representatives** (`app_settings`
`escalation_tag_rule`):

- `TAG_SELECTED_REPRESENTATIVE` (default) — only the primary/selected rep.
- `TAG_ALL_WARD_REPRESENTATIVES` — every current, verified rep of the ward.

Both honor the verified-X gate and the 280-character limit.

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
