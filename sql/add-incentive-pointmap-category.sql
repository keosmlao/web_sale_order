-- Master list of "point categories" (pointmap_category) — the controlled
-- vocabulary that app_incentive_category.pointmap_category draws from
-- (AV / Air / REF / SDA / Washer …). Lets managers define which product
-- categories exist from the UI instead of free-typing.
--
-- Idempotent: safe to re-run. Seeds itself from whatever distinct values
-- already live in app_incentive_category.
CREATE TABLE IF NOT EXISTS app_incentive_pointmap_category (
  code        varchar(40) PRIMARY KEY,
  label       varchar(120) NOT NULL DEFAULT '',
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Backfill from existing category rows so the current 5 values appear at once.
INSERT INTO app_incentive_pointmap_category (code, label)
SELECT DISTINCT TRIM(pointmap_category), TRIM(pointmap_category)
FROM app_incentive_category
WHERE COALESCE(TRIM(pointmap_category), '') <> ''
ON CONFLICT (code) DO NOTHING;
