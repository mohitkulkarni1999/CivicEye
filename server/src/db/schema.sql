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
