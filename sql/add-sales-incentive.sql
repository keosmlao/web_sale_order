-- Database-backed front-store salesperson incentive configuration.
-- Safe to re-run: tables and seed rows are idempotent.

CREATE TABLE IF NOT EXISTS app_incentive_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_amount numeric(18,4) NOT NULL DEFAULT 100,
  currency_code varchar(10) NOT NULL DEFAULT 'THB',
  low_max_pct numeric(8,4) NOT NULL DEFAULT 0.80,
  standard_max_pct numeric(8,4) NOT NULL DEFAULT 1.00,
  low_multiplier numeric(8,4) NOT NULL DEFAULT 0.80,
  standard_multiplier numeric(8,4) NOT NULL DEFAULT 1.00,
  high_multiplier numeric(8,4) NOT NULL DEFAULT 1.10,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_incentive_category (
  category_code varchar(20) PRIMARY KEY,
  category_name varchar(120) NOT NULL,
  group_code varchar(20) NOT NULL CHECK (group_code IN ('CE_SDA', 'AIR')),
  weight numeric(8,4) NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS app_incentive_brand_weight (
  category_code varchar(20) NOT NULL REFERENCES app_incentive_category(category_code) ON DELETE CASCADE,
  brand_code varchar(50) NOT NULL,
  weight numeric(8,4) NOT NULL DEFAULT 1,
  PRIMARY KEY (category_code, brand_code)
);

CREATE TABLE IF NOT EXISTS app_incentive_product_status (
  item_code varchar(50) PRIMARY KEY,
  status_code varchar(40) NOT NULL DEFAULT 'current',
  weight numeric(8,4) NOT NULL DEFAULT 1,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_incentive_gp_tier (
  category_code varchar(20) NOT NULL REFERENCES app_incentive_category(category_code) ON DELETE CASCADE,
  tier_code varchar(20) NOT NULL,
  min_gp_pct numeric(10,6),
  max_gp_pct numeric(10,6),
  weight numeric(8,4) NOT NULL DEFAULT 1,
  PRIMARY KEY (category_code, tier_code)
);

CREATE TABLE IF NOT EXISTS app_incentive_target (
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  group_code varchar(20) NOT NULL CHECK (group_code IN ('CE_SDA', 'AIR')),
  group_target numeric(18,4) NOT NULL,
  staff_count integer NOT NULL CHECK (staff_count > 0),
  PRIMARY KEY (year, month, group_code)
);

CREATE INDEX IF NOT EXISTS app_incentive_product_status_weight_idx
  ON app_incentive_product_status (weight);
CREATE INDEX IF NOT EXISTS app_incentive_target_period_idx
  ON app_incentive_target (year, month);

INSERT INTO app_incentive_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- SML item_category values used by the workbook's eleven incentive categories.
INSERT INTO app_incentive_category (category_code, category_name, group_code) VALUES
  ('008', 'TV', 'CE_SDA'),
  ('009', 'Refrigerator', 'CE_SDA'),
  ('010', 'Freezer', 'CE_SDA'),
  ('011', 'Washer/Dryer', 'CE_SDA'),
  ('032', 'Air conditioner', 'AIR'),
  ('003', 'Audio', 'CE_SDA'),
  ('012', 'Water dispenser', 'CE_SDA'),
  ('013', 'Fan', 'CE_SDA'),
  ('014', 'Small appliance', 'CE_SDA'),
  ('017', 'Air purifier', 'CE_SDA'),
  ('023', 'Small appliance', 'CE_SDA')
ON CONFLICT (category_code) DO UPDATE SET
  category_name = EXCLUDED.category_name,
  group_code = EXCLUDED.group_code;

-- Product overrides present in Product_Status in the supplied workbook.
INSERT INTO app_incentive_product_status (item_code, status_code, weight, note) VALUES
  ('110104-0585', 'special_no_bonus', 0, 'Imported from workbook Product_Status'),
  ('110102-0375', 'special_no_bonus', 0, 'Imported from workbook Product_Status'),
  ('110101-0929', 'special_min_bonus', 0.5, 'Imported from workbook Product_Status')
ON CONFLICT (item_code) DO UPDATE SET
  status_code = EXCLUDED.status_code,
  weight = EXCLUDED.weight,
  note = EXCLUDED.note,
  updated_at = now();

-- Monthly targets copied from Config_Weights, section 8.3 (THB).
INSERT INTO app_incentive_target (year, month, group_code, group_target, staff_count) VALUES
  (2026, 6, 'CE_SDA', 10012100, 7), (2026, 6, 'AIR', 2160000, 2),
  (2026, 7, 'CE_SDA', 9573200, 7),  (2026, 7, 'AIR', 2160000, 2),
  (2026, 8, 'CE_SDA', 10012100, 7), (2026, 8, 'AIR', 1800000, 2),
  (2026, 9, 'CE_SDA', 9513200, 7),  (2026, 9, 'AIR', 1350000, 2),
  (2026, 10, 'CE_SDA', 10834000, 7),(2026, 10, 'AIR', 1850000, 2),
  (2026, 11, 'CE_SDA', 9813200, 7), (2026, 11, 'AIR', 1600000, 2),
  (2026, 12, 'CE_SDA', 11089900, 7),(2026, 12, 'AIR', 1880000, 2)
ON CONFLICT (year, month, group_code) DO UPDATE SET
  group_target = EXCLUDED.group_target,
  staff_count = EXCLUDED.staff_count;
