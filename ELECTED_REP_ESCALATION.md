# CivicEye — Elected Representative & X Escalation Logic

This document explains the logic behind the **automatic elected-representative
detection** and **X (Twitter) escalation** feature. Everything here is
**deterministic and database-backed — there is no AI guessing and no fake X
handles.** Publishing is manual-only (no X API credentials required).

---

## 1. The problem it solves

Citizens report a problem (pothole, garbage, broken light…) at a map point.
They want to know: *"Who is my ward representative, and can I pressure them
publicly?"*

We needed to answer two questions safely:

1. **Which elected representative is responsible for this exact point?**
   - Must be correct. A wrong attribution is worse than no attribution.
2. **Can we post about it publicly on X?**
   - Must never invent an X handle, must never publish personal data, and a
     failed post must never break the citizen's report.

---

## 2. Representative resolution (how we find "who")

Flow — `resolveRepresentativeForPoint(lat, lng)` in
`server/src/services/representative.service.js`:

```
point (lat, lng)
   │
   ▼
1. findBoundaryHit()          every ward whose boundary polygon (outer ring +
                              holes, pure-SQL ray casting) contains the point
   │
   ▼
2. disambiguate               one hit   → that ward
                              2+ hits   → same corporation? WARD_AMBIGUOUS
                                           different corporations? CORPORATION_MISMATCH
   │  (no polygon hit)
   ▼
3. locality fallback          every active locality whose circle contains the
                              point, nearest first → ward (boundary_locality_id
                              else city + ward_no); cross-corporation guard +
                              150 m margin ambiguity guard still apply
   │
   ▼
4. ward → representatives     current reps via ward_representatives join
                              (is_current = true); primary = wards.representative_id
   │
   ▼
5. result                     { matched, canEscalate, reason, source, confidence,
                               corporation, ward, representatives[], representative,
                               mentions, tagRule }
```

### Step 1 — official boundary polygons (primary)

- Ward polygons live in `ward_boundaries` as plain `(lat, lng)` ring points
  (ring 0 = outer ring, subsequent rings = holes). No PostGIS required.
- `point_in_ring()` (ray casting) + `point_in_ward()` are plpgsql functions in
  `server/src/db/schema.sql`; rings must be **closed** (first == last).
- Only wards with a `corporation_id` are polygon-matched; other wards fall
  through to the locality circle fallback.

### Step 2 — disambiguation

- One polygon hit → use that ward.
- Multiple hits from the **same corporation** → `WARD_AMBIGUOUS` (overlapping
  seed boundaries). We refuse to guess.
- Multiple hits from **different corporations** → `CORPORATION_MISMATCH`. A
  single point can never legally be in both PMC and PCMC, so this is a data
  error and is never auto-picked.

### Step 3 — locality circle fallback

- Only used when no polygon contains the point (legacy/approximation wards).
- Computes haversine distance from the point to each active locality centre,
  keeps `distance <= radius_m`, sorts nearest first.
- Maps the best locality to a ward via `boundary_locality_id`, else
  `city + ward_no`.
- A fallback hit is **discarded** if the candidate ward's corporation differs
  from a polygon hit's corporation.

### Step 4 — ward → representatives

- A ward can have **multiple current representatives** (seats A/B/C/D in the
  2026 election system) through the `ward_representatives` join table.
- `wards.representative_id` points at the primary holder (kept in sync by the
  `sync_ward_primary_rep()` trigger).
- Only representatives with `is_current = true` are ever returned.

### Step 5 — result

Every outcome is explicit via a `reason`:

| reason | meaning |
|---|---|
| `OK` | matched, and X account is admin-verified → `canEscalate = true` |
| `WARD_NOT_FOUND` | no locality circle contains the point (no polygon hit) |
| `WARD_NOT_MAPPED` | locality found, but no ward registry row yet |
| `WARD_AMBIGUOUS` | two wards of the same corporation overlap the point → we refuse to guess |
| `CORPORATION_MISMATCH` | wards of different corporations overlap the point → never auto-picked |
| `NO_REPRESENTATIVE` | ward exists but has no current representative |
| `REPRESENTATIVE_INACTIVE` | representative exists but `is_current = false` |
| `X_NOT_VERIFIED` | representative matched but their X account is not admin-verified |

`matched = true` **only** for `OK` (and `X_NOT_VERIFIED` still returns the
matched representatives for display, but never auto-escalates).

---

## 3. Ambiguity guard (the "refuse to guess" rule)

The single most important safety rule.

1. **Polygon overlap (same corporation)** — if the point falls inside more than
   one ward of the same corporation (e.g. overlapping legacy seed polygons), we
   return `WARD_AMBIGUOUS` instead of guessing.
2. **Polygon overlap (different corporations)** — a point inside both a PMC and
   a PCMC ward is jurisdictionally impossible; we return `CORPORATION_MISMATCH`
   and attribute nothing.
3. **Locality fallback margin** — after picking the nearest locality, we check
   every other candidate within a **150 m margin** of the nearest one. If that
   candidate belongs to a **different ward**, we return `WARD_AMBIGUOUS`.

```
nearest locality .......... distance 20 m  → Ward 21
second locality .......... distance 140 m → Ward 22   ← within 150 m margin
────────────────────────────────────────────────────
RESULT: WARD_AMBIGUOUS — no representative returned
```

Rationale: at a ward boundary, guessing the wrong Nagar Sevak and publicly
tagging them is worse than showing "could not determine". If we can't be sure,
we say so.

### Confidence

`source` records how the ward was found (`official_boundary` vs
`locality_radius`), and `confidence` is computed from the polygon containment /
distance ratio:

```
official_boundary hit  → high
locality ratio < 0.5   → high
locality ratio < 0.9   → medium
else                   → low
```

---

## 4. Representative ↔ ward → issue wiring

- A report point resolves to a representative **before** the issue row is
  inserted, so `issues.representative_id` is written atomically with the report
  (`server/src/controllers/issues.controller.js`).
- The issue also stores the resolved jurisdiction at report time:
  `corporation_id`, `ward_id`, `resolution_source` and
  `resolution_confidence`, so the attribution is auditable even if the
  boundaries change later.
- The same resolution is used to draft the escalation, so the report and its
  escalation can never disagree on the representative.
- `GET /api/issues/:id` returns `representative` (primary), `representatives[]`
  (all current reps of the ward, public-safe shape), `ward` (number/name/
  corporation) and `corporation`.

### Public-safe shapes

- `pickRepresentative()` strips internal fields; always shows `x_profile_url`
  computed from the username, never raw secrets.
- `pickEscalation()` exposes only `id, status, post_type, generated_text,
  external_post_url, published_at, approved_by, failure_reason, created_at,
  updated_at`.

---

## 5. Escalation lifecycle (state machine)

`server/src/services/escalation.service.js`

```
                ┌─────────────────────────────────────────┐
                │                                         │
                v                                         │
 PENDING ──► READY ──► APPROVED ──► PUBLISHED             │
   │         │  │        │                                 │
   │         │  └──► REJECTED (terminal)                   │
   │         └────► FAILED ──► (retry → PENDING) ──────────┘
   └──────────────► FAILED
```

| status | meaning |
|---|---|
| `PENDING` | representative identified; post text not generated yet (e.g. X not verified) |
| `READY` | sanitized post text generated, awaiting approval |
| `APPROVED` | approved by admin/officer; citizen can now share via X compose |
| `PUBLISHED` | publicly posted (manual; `external_post_url` recorded) |
| `REJECTED` | rejected with an optional `failure_reason` |
| `FAILED` | generation/other error — **retry allowed only from FAILED** |

Rules enforced by `transitionTo()`:

- Every transition is validated against `ESCALATION_FLOW`; illegal transitions
  throw.
- **Retry is only possible from `FAILED`** (and bumps `retry_count`).
- Only `APPROVED` can be marked `PUBLISHED`.
- Once `PUBLISHED` or `REJECTED`, nothing can change it (terminal states).

### One row per issue per post type

`UNIQUE (issue_id, post_type)` guarantees at most one **report** post and one
**resolution** post per issue. Drafting is idempotent (`ON CONFLICT DO
NOTHING`) so re-processing an issue never duplicates posts.

### Audit trail

Every state change writes an `audit_logs` row:
`escalation.created / .ready / .approved / .rejected / .published /
.text_updated / .retried`, including `from → to` and the actor id. Everything
is traceable.

---

## 6. What triggers an escalation

### Report post

`maybeCreateReportEscalation()` runs inside `createIssue`:

1. Resolves the representative (or reuses the pre-resolved result).
2. Persists `issues.representative_id` even if escalation can't happen yet.
3. If the representative **cannot** escalate (no match / not verified), it
   returns `null` quietly — **the report still succeeds**.
4. If it **can** escalate, inserts the escalation as `PENDING`, generates the
   sanitized post text, and moves it to `READY`.

### Resolution post

`maybeCreateResolutionEscalation()` runs when an officer sets an issue to
`RESOLVED`:

- It only drafts a resolution post if the **report** post was actually
  `PUBLISHED` (public accountability — don't announce fixes nobody saw).
- Uses the same representative as the report post.

### Non-fatal by design

Both hooks wrap all work in try/catch and log a warning on failure. A broken
post can never roll back or block the citizen's report, the resolution, or the
notification flow.

---

## 7. Post generation & sanitization

`server/src/services/post-generator.service.js`

### Sanitization of citizen text

Before anything goes public, the citizen-supplied description is scrubbed:

- **URLs** — removed.
- **Emails** — removed.
- **Phone numbers** — removed (regex: `+?` digits, 7+ digits, allowing
  `()-` separators).
- **`@mentions`** — stripped, so no unrelated account is ever tagged.
- **`#hashtags`** — stripped.
- **Control characters / whitespace** — collapsed.

The **only** `@mention`s that can appear in the post are verified
representative handles (and only on `report` posts). Which handles are tagged is
driven by the admin-configurable `escalation_tag_rule`:

```
TAG_SELECTED_REPRESENTATIVE      → mention only the primary rep (default)
TAG_ALL_WARD_REPRESENTATIVES     → mention every current, verified rep of the ward
```

In both cases each rep is only included when it is admin-verified **and** has a
username (`x_verified_by_admin` + `official_x_username`). The resolution result
carries `mentions[]`, and `generateXPost()` builds the `@mention` prefix from
that array (deduped, `@`-stripped).

### Deterministic composition

```
"{category}: {sanitized text}. Ward {ward_number}. Reported via CivicEye. "
"{area}, {city}. Issue #{public_id}. {issue URL} #CivicEye #Nagarsevak"
```

- Fixed hashtags `#CivicEye #Nagarsevak` are always appended.
- The issue URL (`{clientUrl}/issue/{public_id}`) is always included so the
  post points back to the public record.
- Hard **280-character cap**: truncation is deterministic (on word boundaries),
  never random, so the same input always produces the same post.
- The rep handles + hashtags + URL are kept even when text is truncated —
  citizen text is sacrificed first.

### Manual share (no X API)

Approved posts are shared by the user:

- **"Post on X"** → opens `https://x.com/intent/tweet?text=<urlencoded>`.
- **"Copy post"** → copies the exact text to the clipboard.

No API keys, no auto-publishing of anything, ever. The `AUTO_X_POST` /
`X_INTEGRATION_ENABLED` env vars exist only as future hooks and default to
`false`.

---

## 8. Permissions & scope

- **Public:** `GET /api/representatives/resolve?lat&lng` — anyone can resolve a
  representative for a point. Validates coordinates (finite, within ±90/±180).
- **Admin:** full CRUD on representatives and wards, verify X accounts, and
  approve/reject/publish/retry/edit any escalation.
- **Officer:** can act on escalations **only for their own department**
  (`loadScopedEscalation` — if `esc.department_id !== user.department_id` →
  403). Admins are unrestricted.
- **Rate limiting:** all escalation mutation routes use `escalateLimiter`
  (15 req/min) to prevent abuse.

---

## 9. Seeding & data integrity

- **Wards** (`seedWards`) — idempotent, one ward per `(city, ward_no)` created
  from the existing locality data, each with a **boundary ring** in
  `ward_boundaries` (a 16-gon circle around the locality for legacy wards, or an
  explicit polygon where real boundaries exist). Re-running never duplicates.
- **PMC Ward 32 (Warje-Popularnagar)** — seeded with its official 2026 election
  polygon and the **four elected corporators** (Harshada Bhosale, Bharatbhushan
  Barate, Sayali Wanjale, Sachin Dodke) with `data_source = 'pune_2026_election'`
  and **no X handles** — so nothing escalates until the admin adds and verifies
  their X accounts. Warje points resolve to PMC Ward 32, never to Karve Nagar.
- **Demo representatives** (`seedDemoRepresentatives`) — only when
  `DEMO_MODE=true`, clearly marked with `data_source = 'demo_seed'`, **never**
  given X usernames, so they can never be published. Uses `COALESCE` so
  admin-assigned reps are never overwritten.
- **Database migrations** are idempotent (`npm run db:migrate` — "schema is up
  to date" on re-run).

---

## 10. Failure modes (and why nothing breaks)

| failure | system behaviour |
|---|---|
| No polygon or locality near the point | `WARD_NOT_FOUND`; report saves normally, no escalation |
| Ward not yet mapped | `WARD_NOT_MAPPED`; report saves, escalation waits for mapping |
| Boundary ambiguity (same corp) | `WARD_AMBIGUOUS`; nothing attributed, no guess |
| Cross-corporation overlap | `CORPORATION_MISMATCH`; nothing attributed — jurisdictionally impossible |
| Representative not verified | `X_NOT_VERIFIED`; matched for display, no post drafted |
| Post generation throws | caught + logged; escalation stays `PENDING`, report unaffected |
| Officer from wrong department | `403`; action refused |
| Rate limit exceeded | `429`; requests blocked for a short window |

---

## 11. Files

| file | role |
|---|---|
| `server/src/services/representative.service.js` | polygon + fallback resolution, corporation gating, tag rule, CRUD |
| `server/src/services/escalation.service.js` | state machine + lifecycle + drafts |
| `server/src/services/post-generator.service.js` | sanitization + 280-char composer + share URL + mentions |
| `server/src/services/audit.service.js` | audit-log writer |
| `server/src/controllers/representative.controller.js` | public resolve + admin reps/wards/corporations/tag-rule handlers |
| `server/src/controllers/escalation.controller.js` | approve/reject/publish/retry/text + dept scope |
| `server/src/controllers/issues.controller.js` | `createIssue` + `getIssue` integration |
| `server/src/controllers/officer.controller.js` | resolution-post hook |
| `server/src/db/schema.sql` | `corporations`, `wards`, `ward_boundaries`, `representatives`, `ward_representatives`, `app_settings`, `issue_escalations`, `audit_logs` + `point_in_ring()` / `point_in_ward()` |
| `server/src/db/seed.js` | ward boundaries + Ward 32 polygon + verified representatives + demo seeding |
| `server/test/escalation.test.mjs` | escalation end-to-end suite (40 steps) |
| `server/test/jurisdiction.test.mjs` | municipal jurisdiction suite (44 steps) |
