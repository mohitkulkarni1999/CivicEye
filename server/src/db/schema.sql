-- CivicEye API schema (PostgreSQL)

-- Geographic helpers ---------------------------------------------------------
-- PostGIS is optional; these functions let the core platform work without it.

CREATE OR REPLACE FUNCTION haversine(
  lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (
    6371000.0 * acos(
      LEAST(1.0,
        sin(radians(lat1)) * sin(radians(lat2)) +
        cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2 - lng1))
      )
    )
  )
$$;

CREATE OR REPLACE FUNCTION refresh_issue_department() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.department_id := COALESCE(
    NEW.department_id,
    (SELECT department_id FROM categories WHERE id = NEW.category_id)
  );
  RETURN NEW;
END;
$$;

-- Extensions ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Roles (not a table — stored on users.role) ---------------------------------

CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  color       TEXT NOT NULL DEFAULT '#64748b',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  icon          TEXT,
  color         TEXT NOT NULL DEFAULT '#64748b',
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT UNIQUE,
  phone            TEXT UNIQUE,
  name             TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'citizen'
                   CHECK (role IN ('citizen','moderator','officer','admin')),
  department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
  avatar_url       TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo          BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  city       TEXT NOT NULL DEFAULT '',
  area       TEXT NOT NULL DEFAULT '',
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  radius_m   INTEGER NOT NULL DEFAULT 1000,
  landmark   TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id        SERIAL UNIQUE NOT NULL,
  reporter_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  is_anonymous     BOOLEAN NOT NULL DEFAULT FALSE,
  category_id      UUID NOT NULL REFERENCES categories(id),
  department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'REPORTED'
                   CHECK (status IN ('REPORTED','AI_REVIEW','VERIFIED','ASSIGNED',
                                     'IN_PROGRESS','RESOLVED','VERIFIED_RESOLVED',
                                     'REOPENED','REJECTED')),
  severity         TEXT NOT NULL DEFAULT 'MODERATE'
                   CHECK (severity IN ('LOW','MODERATE','HIGH','CRITICAL')),
  lat              DOUBLE PRECISION NOT NULL,
  lng              DOUBLE PRECISION NOT NULL,
  address          TEXT NOT NULL DEFAULT '',
  area             TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  landmark         TEXT NOT NULL DEFAULT '',
  priority_score   INTEGER NOT NULL DEFAULT 0,
  priority_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0,
  duplicate_of_id  UUID REFERENCES issues(id) ON DELETE SET NULL,
  is_duplicate_suspect BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo          BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden        BOOLEAN NOT NULL DEFAULT FALSE,
  reported_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  reopened_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issues_status        ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_severity      ON issues(severity);
CREATE INDEX IF NOT EXISTS idx_issues_category      ON issues(category_id);
CREATE INDEX IF NOT EXISTS idx_issues_created_at    ON issues(created_at);
CREATE INDEX IF NOT EXISTS idx_issues_lat_lng       ON issues(lat, lng);
CREATE INDEX IF NOT EXISTS idx_issues_area          ON issues(area);
CREATE INDEX IF NOT EXISTS idx_issues_public_id     ON issues(public_id);
CREATE INDEX IF NOT EXISTS idx_issues_trgm_title    ON issues USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_issues_trgm_address  ON issues USING GIN (address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_issues_trgm_desc     ON issues USING GIN (description gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_issues_default_dept ON issues;
CREATE TRIGGER trg_issues_default_dept
  BEFORE INSERT ON issues
  FOR EACH ROW EXECUTE FUNCTION refresh_issue_department();

CREATE TABLE IF NOT EXISTS issue_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    UUID REFERENCES issues(id) ON DELETE CASCADE,
  uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
  url         TEXT NOT NULL,
  thumb_url   TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'before'
              CHECK (kind IN ('before','evidence','official','after','cover','video','audio')),
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  perceptual_hash TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- video / voice-note evidence: keep the transcoded copy in url and the
-- original file in original_url so viewers can watch at full quality
ALTER TABLE issue_images
  ADD COLUMN IF NOT EXISTS original_url   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_mime  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_duration REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_issue_images_issue ON issue_images(issue_id);

CREATE TABLE IF NOT EXISTS issue_status_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id     UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  changed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_issue ON issue_status_history(issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_confirmations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  is_demo    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_confirm_user_issue
  ON issue_confirmations(issue_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  direction  TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, user_id)
);

-- allow anonymous demo votes (relaxed from NOT NULL)
ALTER TABLE issue_votes ALTER COLUMN user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS issue_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id      UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  is_official   BOOLEAN NOT NULL DEFAULT FALSE,
  body          TEXT NOT NULL,
  is_hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_issue ON issue_comments(issue_id, created_at);

CREATE TABLE IF NOT EXISTS issue_followers (
  issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);

CREATE TABLE IF NOT EXISTS issue_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id      UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  assigned_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT NOT NULL DEFAULT '',
  is_current    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignments_issue ON issue_assignments(issue_id);
CREATE INDEX IF NOT EXISTS idx_assignments_dept  ON issue_assignments(department_id);

CREATE TABLE IF NOT EXISTS issue_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id      UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL DEFAULT 'official' CHECK (evidence_type IN ('citizen','official')),
  image_id      UUID REFERENCES issue_images(id) ON DELETE SET NULL,
  submitted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT NOT NULL DEFAULT '',
  ai_analysis   JSONB,
  status        TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending_review','accepted','rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id         UUID REFERENCES issues(id) ON DELETE SET NULL,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('image','repair_verification','duplicate')),
  input_image_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider         TEXT NOT NULL DEFAULT 'heuristic',
  model            TEXT,
  result           JSONB NOT NULL,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_issue ON ai_analysis(issue_id, created_at);

-- allow AI official lookups, moderation, triage, summaries, query parsing, digests and chat in the analysis log
ALTER TABLE ai_analysis DROP CONSTRAINT IF EXISTS ai_analysis_kind_check;
ALTER TABLE ai_analysis ADD CONSTRAINT ai_analysis_kind_check
  CHECK (kind IN ('image','repair_verification','duplicate','official_lookup',
                  'moderation','triage','summary','query_parse','digest','chat'));

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id       UUID REFERENCES issues(id) ON DELETE SET NULL,
  comment_id     UUID REFERENCES issue_comments(id) ON DELETE SET NULL,
  reporter_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved','dismissed')),
  handled_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO admin_settings (key, value) VALUES
  ('ai_config', '{"provider":"heuristic","label":"Local heuristic analysis (offline)"}'::jsonb),
  ('site_config', '{"city":"Pune","demo_mode":true,"maintenance":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  url         TEXT NOT NULL,
  thumb_url   TEXT NOT NULL DEFAULT '',
  mime        TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  perceptual_hash TEXT,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE uploads
  ADD COLUMN IF NOT EXISTS original_url     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS original_mime    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_duration   REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcode_status TEXT NOT NULL DEFAULT 'done';

-- Update updated_at triggers ------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_users_touch ON users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_categories_touch ON categories;
CREATE TRIGGER trg_categories_touch BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_departments_touch ON departments;
CREATE TRIGGER trg_departments_touch BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Locality & responsible-official support ------------------------------------
-- Administrative unit types: metro_ward | municipal_ward | town | village
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS type         TEXT NOT NULL DEFAULT 'metro_ward',
  ADD COLUMN IF NOT EXISTS ward_no      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS landmark     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_role TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_party TEXT NOT NULL DEFAULT '';

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS locality_id    UUID REFERENCES locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locality_type  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ward_no        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_name   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_role   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_phone  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS officer_party  TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_locations_active_geo ON locations(lat, lng) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_issues_locality ON issues(locality_id);

-- Elected representatives & X escalation --------------------------------------
-- Single source of truth for elected representatives (Nagarsevak / Sarpanch /
-- Corporator). Verified manually by admins — never guessed by AI. An escalation
-- to X is only possible when x_verified_by_admin = true AND the official X
-- username is set.

CREATE TABLE IF NOT EXISTS representatives (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  designation         TEXT NOT NULL DEFAULT 'Nagar Sevak (Corporator)',
  constituency        TEXT NOT NULL DEFAULT '',
  official_x_username TEXT NOT NULL DEFAULT '',
  official_x_user_id  TEXT NOT NULL DEFAULT '',
  x_profile_url       TEXT NOT NULL DEFAULT '',
  x_verified_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  data_source         TEXT NOT NULL DEFAULT '',
  source_url          TEXT NOT NULL DEFAULT '',
  active_from         DATE,
  active_until        DATE,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  last_verified_at    TIMESTAMPTZ,
  notes               TEXT NOT NULL DEFAULT '',
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reps_current ON representatives(is_current)
  WHERE is_current = true;

-- Wards registry. Each ward links to the locality record that provides its
-- centre/radius (boundary_locality_id) and to its elected representative.
CREATE TABLE IF NOT EXISTS wards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city                 TEXT NOT NULL,
  ward_number          TEXT NOT NULL,
  ward_name            TEXT NOT NULL DEFAULT '',
  boundary_locality_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  representative_id    UUID REFERENCES representatives(id) ON DELETE SET NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city, ward_number)
);

CREATE INDEX IF NOT EXISTS idx_wards_locality ON wards(boundary_locality_id);
CREATE INDEX IF NOT EXISTS idx_wards_rep ON wards(representative_id);

-- Tracks one X escalation per issue (report post + optional resolution post).
CREATE TABLE IF NOT EXISTS issue_escalations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id           UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  representative_id  UUID REFERENCES representatives(id) ON DELETE SET NULL,
  platform           TEXT NOT NULL DEFAULT 'x',
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','READY','APPROVED','PUBLISHED',
                                       'REJECTED','FAILED')),
  generated_text     TEXT NOT NULL DEFAULT '',
  external_post_id   TEXT NOT NULL DEFAULT '',
  external_post_url  TEXT NOT NULL DEFAULT '',
  published_at       TIMESTAMPTZ,
  approved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  failure_reason     TEXT NOT NULL DEFAULT '',
  retry_count        INTEGER NOT NULL DEFAULT 0,
  post_type          TEXT NOT NULL DEFAULT 'report'
                     CHECK (post_type IN ('report','resolution')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, post_type)
);

CREATE INDEX IF NOT EXISTS idx_escalations_issue ON issue_escalations(issue_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON issue_escalations(status)
  WHERE status IN ('READY','PENDING','APPROVED');

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS representative_id UUID REFERENCES representatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_issues_representative ON issues(representative_id);

-- Append-only audit trail for representative changes and escalation actions.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL DEFAULT '',
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);

DROP TRIGGER IF EXISTS trg_reps_touch ON representatives;
CREATE TRIGGER trg_reps_touch BEFORE UPDATE ON representatives
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_wards_touch ON wards;
CREATE TRIGGER trg_wards_touch BEFORE UPDATE ON wards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_escalations_touch ON issue_escalations;
CREATE TRIGGER trg_escalations_touch BEFORE UPDATE ON issue_escalations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Municipal corporations (jurisdiction owners of wards) ----------------------
-- PMC = Pune Municipal Corporation, PCMC = Pimpri-Chinchwad Municipal Corp.
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS corporation_code TEXT NOT NULL DEFAULT '';
-- A point is always inside exactly one corporation's jurisdiction; a ward can
-- never span corporations. This is the first-class gate that prevents a PCMC
-- representative ever being shown for a PMC point (and vice-versa).
CREATE TABLE IF NOT EXISTS corporations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO corporations (code, name, city)
VALUES ('PMC', 'Pune Municipal Corporation', 'Pune'),
       ('PCMC', 'Pimpri-Chinchwad Municipal Corporation', 'Pimpri-Chinchwad')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, city = EXCLUDED.city, is_active = true;

-- Ward registry gains corporation ownership + boundary provenance.
ALTER TABLE wards
  ADD COLUMN IF NOT EXISTS corporation_id UUID REFERENCES corporations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_url        TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_wards_corporation ON wards(corporation_id);
-- One ward per corporation (legacy UNIQUE(city, ward_number) kept for the rows
-- that predate corporation assignment).
CREATE UNIQUE INDEX IF NOT EXISTS ux_wards_corp_number
  ON wards(corporation_id, ward_number) WHERE corporation_id IS NOT NULL;

-- Representative identity fields (source of truth for elected reps).
ALTER TABLE representatives
  ADD COLUMN IF NOT EXISTS corporation_id UUID REFERENCES corporations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS party          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seat           TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_reps_corporation ON representatives(corporation_id);

-- Issues capture the exact jurisdiction + resolution provenance.
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS corporation_id      UUID REFERENCES corporations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ward_id             UUID REFERENCES wards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_source   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolution_confidence TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_issues_ward ON issues(ward_id);
CREATE INDEX IF NOT EXISTS idx_issues_corporation ON issues(corporation_id);

-- Official ward boundaries as normalized ring points.
--   ring_idx = 0   : outer ring of the ward polygon
--   ring_idx > 0   : holes inside the outer ring
-- A ward with no boundary rows cannot be polygon-matched (locality fallback).
-- Coordinates are stored as lat/lng so point-in-polygon needs no PostGIS.
CREATE TABLE IF NOT EXISTS ward_boundaries (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id  UUID NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  ring_idx INTEGER NOT NULL DEFAULT 0,
  seq      INTEGER NOT NULL,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL,
  UNIQUE (ward_id, ring_idx, seq)
);

CREATE INDEX IF NOT EXISTS idx_ward_boundaries_ward ON ward_boundaries(ward_id);

-- Many-to-many ward <-> representative. Modern PMC/PCMC wards elect multiple
-- corporators (seats A/B/C/D). wards.representative_id stays as the "primary"
-- seat for backward compatibility; the join table is authoritative.
CREATE TABLE IF NOT EXISTS ward_representatives (
  ward_id          UUID NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  representative_id UUID NOT NULL REFERENCES representatives(id) ON DELETE CASCADE,
  seat             TEXT NOT NULL DEFAULT '',
  is_current       BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (ward_id, representative_id)
);

CREATE INDEX IF NOT EXISTS idx_ward_reps_rep ON ward_representatives(representative_id);

-- Keep wards.representative_id in sync with the primary current seat.
CREATE OR REPLACE FUNCTION sync_ward_primary_rep() RETURNS TRIGGER AS $$
DECLARE
  target UUID := COALESCE(NEW.ward_id, OLD.ward_id);
BEGIN
  UPDATE wards w SET representative_id = sub.rep_id
  FROM (
    SELECT wr.representative_id AS rep_id
      FROM ward_representatives wr
      JOIN representatives r ON r.id = wr.representative_id
     WHERE wr.ward_id = target AND wr.is_current = true AND r.is_current = true
     ORDER BY wr.seat = '' ASC, wr.seat ASC, wr.representative_id ASC
     LIMIT 1
  ) sub
  WHERE w.id = target;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ward_reps_sync ON ward_representatives;
CREATE TRIGGER trg_ward_reps_sync
  AFTER INSERT OR UPDATE OR DELETE ON ward_representatives
  FOR EACH ROW EXECUTE FUNCTION sync_ward_primary_rep();

-- Admin-configurable escalation behaviour (e.g. which representatives to tag).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES ('escalation_tag_rule', 'TAG_SELECTED_REPRESENTATIVE')
ON CONFLICT (key) DO NOTHING;

-- Point-in-polygon (ray casting) over ward_boundaries. No PostGIS required.
-- PNPOLY-style: a point is inside a ring when an even number of ring edges
-- cross its horizontal ray. Coordinates are (lat, lng).
CREATE OR REPLACE FUNCTION point_in_ring(
  plat DOUBLE PRECISION,
  plng DOUBLE PRECISION,
  wid  UUID,
  ring INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  r         RECORD;
  prev      RECORD;
  have_prev BOOLEAN := FALSE;
  inside    BOOLEAN := FALSE;
BEGIN
  FOR r IN SELECT lat, lng FROM ward_boundaries WHERE ward_id = wid AND ring_idx = ring ORDER BY seq
  LOOP
    IF NOT have_prev THEN
      prev := r;
      have_prev := TRUE;
      CONTINUE;
    END IF;
    IF (r.lng > plng) <> (prev.lng > plng) THEN
      IF (prev.lat + (plng - prev.lng) * (r.lat - prev.lat) / (r.lng - prev.lng)) > plat THEN
        inside := NOT inside;
      END IF;
    END IF;
    prev := r;
  END LOOP;
  RETURN inside;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION point_in_ward(
  plat DOUBLE PRECISION,
  plng DOUBLE PRECISION,
  wid  UUID
) RETURNS BOOLEAN AS $$
DECLARE
  hole INTEGER;
BEGIN
  IF NOT point_in_ring(plat, plng, wid, 0) THEN
    RETURN FALSE;
  END IF;
  FOR hole IN SELECT DISTINCT ring_idx FROM ward_boundaries WHERE ward_id = wid AND ring_idx > 0
  LOOP
    IF point_in_ring(plat, plng, wid, hole) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;
