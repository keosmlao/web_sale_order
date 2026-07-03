-- Monthly point map.
-- Each point-map row now belongs to an effect month (first day of month). Reports
-- resolve points with carry-forward: for a report month M, the row with the newest
-- effect_month <= M per (category, brand, design, size) wins. So a month only needs
-- rows for the combinations whose points CHANGED that month.
--
-- Existing rows get effect_month 2026-01-01 so every 2026 month keeps its current
-- numbers until an override is entered.
--
-- NOTE: run AFTER sql/add-incentive-point-map.sql and sql/add-pointmap-gaps.sql.
-- Those seed files must NOT be re-run after this migration (their ON CONFLICT
-- targets the old 4-column primary key, which no longer exists).
-- Safe to re-run this file itself.

ALTER TABLE app_incentive_point_map
  ADD COLUMN IF NOT EXISTS effect_month date NOT NULL DEFAULT '2026-01-01';

-- Rebuild the PK so the same combination can carry a different score per month.
-- effect_month goes last so the (category, brand, design, size, month <= M) lookup
-- is a single index range scan.
ALTER TABLE app_incentive_point_map
  DROP CONSTRAINT IF EXISTS app_incentive_point_map_pkey;
ALTER TABLE app_incentive_point_map
  ADD CONSTRAINT app_incentive_point_map_pkey
  PRIMARY KEY (category_code, brand_code, design_token, size_token, effect_month);

-- effect_month must always be the first of a month.
ALTER TABLE app_incentive_point_map
  DROP CONSTRAINT IF EXISTS app_incentive_point_map_effect_month_check;
ALTER TABLE app_incentive_point_map
  ADD CONSTRAINT app_incentive_point_map_effect_month_check
  CHECK (effect_month = date_trunc('month', effect_month)::date);
