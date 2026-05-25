-- Loyalty / points-collection configuration table.
-- Manager edits the earn rate on /loyalty; POS reads the active row when
-- awarding points on settlement. Business rule: 70,000 kip = 1 point.

CREATE TABLE IF NOT EXISTS app_loyalty_config (
  id                    BIGSERIAL PRIMARY KEY,
  earn_kip_per_point    NUMERIC(18, 4) NOT NULL DEFAULT 70000,
  redeem_points_per_kip NUMERIC(18, 4) NOT NULL DEFAULT 1,
  min_redeem_points     NUMERIC(18, 4) NOT NULL DEFAULT 0,
  point_name            VARCHAR(50),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  note                  TEXT,
  updated_by            VARCHAR(20),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Older local databases may already have this table in the original
-- singleton shape:
--   id SMALLINT CHECK (id = 1), earn_rate, redeem_rate, enabled, updated_at
-- CREATE TABLE IF NOT EXISTS does not modify that table, so keep this script
-- idempotent by upgrading any existing singleton table in place.
ALTER TABLE app_loyalty_config
  DROP CONSTRAINT IF EXISTS app_loyalty_config_id_check;

ALTER TABLE app_loyalty_config
  ALTER COLUMN id TYPE BIGINT;

CREATE SEQUENCE IF NOT EXISTS app_loyalty_config_id_seq;

SELECT setval(
  'app_loyalty_config_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM app_loyalty_config), 0), 1),
  TRUE
);

ALTER SEQUENCE app_loyalty_config_id_seq
  OWNED BY app_loyalty_config.id;

ALTER TABLE app_loyalty_config
  ALTER COLUMN id SET DEFAULT nextval('app_loyalty_config_id_seq');

ALTER TABLE app_loyalty_config
  ADD COLUMN IF NOT EXISTS earn_kip_per_point NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS redeem_points_per_kip NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS point_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(20),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE app_loyalty_config
SET
  earn_kip_per_point = COALESCE(earn_kip_per_point, earn_rate),
  redeem_points_per_kip = COALESCE(redeem_points_per_kip, redeem_rate),
  is_active = COALESCE(is_active, enabled, TRUE),
  created_at = COALESCE(created_at, updated_at, NOW())
WHERE
  earn_kip_per_point IS NULL
  OR redeem_points_per_kip IS NULL
  OR is_active IS NULL
  OR created_at IS NULL;

ALTER TABLE app_loyalty_config
  ALTER COLUMN earn_kip_per_point SET DEFAULT 70000,
  ALTER COLUMN earn_kip_per_point SET NOT NULL,
  ALTER COLUMN redeem_points_per_kip SET DEFAULT 1,
  ALTER COLUMN redeem_points_per_kip SET NOT NULL,
  ALTER COLUMN min_redeem_points SET DEFAULT 0,
  ALTER COLUMN min_redeem_points SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT TRUE,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_loyalty_config_active
  ON app_loyalty_config (is_active, updated_at DESC);
