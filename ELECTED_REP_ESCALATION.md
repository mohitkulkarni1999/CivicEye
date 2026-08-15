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
1. findCandidates()          every active locality whose circle contains the point,
                             sorted by distance (nearest first)
   │
   ▼
2. best locality → ward     ward = wards where boundary_locality_id = locality.id
                             └ fallback: wards where (city, ward_no) = locality.(city, ward_no)
   │
   ▼
3. ward → representative    representatives where id = ward.representative_id
                             (must have is_current = true)
   │
   ▼
4. result                   { matched, canEscalate, reason, confidence,
                              locality, ward, representative }
```

### Step 1 — locality candidates

- Reads **all active localities** from the `locations` table.
- Computes the haversine distance from the point to each locality centre.
- Keeps only localities where `distance <= radius_m`.
- Sorts by distance, nearest first.

### Step 2 — locality → ward

- If the locality was seeded with `boundary_locality_id` on its ward, use it.
- Otherwise fall back to `city + ward_no` (both stored on the locality row).
- Only `is_active = true` wards are considered.

### Step 3 — ward → representative

- `wards.representative_id` points at the current holder.
- Only representatives with `is_current = true` are ever returned.

### Step 4 — result

Every outcome is explicit via a `reason`:

| reason | meaning |
|---|---|
| `OK` | matched, and X account is admin-verified → `canEscalate = true` |
| `WARD_NOT_FOUND` | no locality circle contains the point |
| `WARD_NOT_MAPPED` | locality found, but no ward registry row yet |
| `WARD_AMBIGUOUS` | two different wards overlap the point → we refuse to guess |
| `NO_REPRESENTATIVE` | ward exists but has no representative assigned |
| `REPRESENTATIVE_INACTIVE` | representative exists but `is_current = false` |
| `X_NOT_VERIFIED` | representative matched but their X account is not admin-verified |

`matched = true` **only** for `OK`.

---

## 3. Ambiguity guard (the "refuse to guess" rule)

The single most important safety rule.

After picking the nearest locality, we check every other candidate within a
**150 m margin** of the nearest one. If that candidate belongs to a
**different ward**, we return `WARD_AMBIGUOUS` instead of guessing.

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

For matched/near-miss cases we also compute a confidence label from the ratio
of the point's distance to the locality's radius:

```
ratio < 0.5  → high
ratio < 0.9  → medium
else         → low
```

---

## 4. Representative ↔ ward → issue wiring

- A report point resolves to a representative **before** the issue row is
  inserted, so `issues.representative_id` is written atomically with the report
  (`server/src/controllers/issues.controller.js`).
- The same resolution is used to draft the escalation, so the report and its
  escalation can never disagree on the representative.
- `GET /api/issues/:id` returns `representative` (public-safe shape) and the
  `escalations[]` array.

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

The **only** `@mention` that can appear in the post is the verified
representative's handle (and only on `report` posts):

```
if postType === 'report' AND representative is admin-verified AND has username:
    mention = "@verifiedhandle "
```

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
- The rep handle + hashtags + URL are kept even when text is truncated —
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
  from the existing locality data. Re-running never duplicates.
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
| No locality near the point | `WARD_NOT_FOUND`; report saves normally, no escalation |
| Ward not yet mapped | `WARD_NOT_MAPPED`; report saves, escalation waits for mapping |
| Boundary ambiguity | `WARD_AMBIGUOUS`; nothing attributed, no guess |
| Representative not verified | `X_NOT_VERIFIED`; matched for display, no post drafted |
| Post generation throws | caught + logged; escalation stays `PENDING`, report unaffected |
| Officer from wrong department | `403`; action refused |
| Rate limit exceeded | `429`; requests blocked for a short window |

---

## 11. Files

| file | role |
|---|---|
| `server/src/services/representative.service.js` | resolution + ambiguity guard + CRUD |
| `server/src/services/escalation.service.js` | state machine + lifecycle + drafts |
| `server/src/services/post-generator.service.js` | sanitization + 280-char composer + share URL |
| `server/src/services/audit.service.js` | audit-log writer |
| `server/src/controllers/representative.controller.js` | public resolve + admin reps/wards handlers |
| `server/src/controllers/escalation.controller.js` | approve/reject/publish/retry/text + dept scope |
| `server/src/controllers/issues.controller.js` | `createIssue` + `getIssue` integration |
| `server/src/controllers/officer.controller.js` | resolution-post hook |
| `server/src/db/schema.sql` | `representatives`, `wards`, `issue_escalations`, `audit_logs` tables |
| `server/src/db/seed.js` | ward + demo-representative seeding |
| `server/test/escalation.test.mjs` | end-to-end suite (40 steps) |
