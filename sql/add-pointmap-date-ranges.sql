-- Date-range point rules with explicit single-day overrides.
CREATE TABLE IF NOT EXISTS app_incentive_point_rule (
  id             BIGSERIAL PRIMARY KEY,
  category_code  VARCHAR(10) NOT NULL,
  brand_code     VARCHAR(50) NOT NULL,
  design_token   VARCHAR(40) NOT NULL DEFAULT '',
  size_token     VARCHAR(40) NOT NULL DEFAULT '',
  effective_from DATE NOT NULL,
  effective_to   DATE NOT NULL,
  points         NUMERIC(10,4) NOT NULL CHECK (points >= 0),
  is_special     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to >= effective_from),
  CHECK (NOT is_special OR effective_to = effective_from),
  UNIQUE (category_code, brand_code, design_token, size_token, effective_from, effective_to, is_special)
);

CREATE INDEX IF NOT EXISTS idx_incentive_point_rule_lookup
  ON app_incentive_point_rule (category_code, brand_code, design_token, size_token, effective_from, effective_to);

-- Convert monthly carry-forward rows into non-overlapping ranges. Safe to rerun.
WITH monthly AS (
  SELECT category_code, brand_code, design_token, size_token, points, effect_month,
         LEAD(effect_month) OVER (
           PARTITION BY category_code, brand_code, design_token, size_token ORDER BY effect_month
         ) AS next_month
  FROM app_incentive_point_map
)
INSERT INTO app_incentive_point_rule
  (category_code, brand_code, design_token, size_token, effective_from, effective_to, points, is_special)
SELECT category_code, brand_code, design_token, size_token, effect_month,
       COALESCE(next_month - 1, DATE '2099-12-31'), points, FALSE
FROM monthly
ON CONFLICT (category_code, brand_code, design_token, size_token, effective_from, effective_to, is_special)
DO NOTHING;
