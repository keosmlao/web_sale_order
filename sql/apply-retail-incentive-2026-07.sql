-- July 2026 Retail incentive rules from 20260701-Retail incentive.xlsx.
--
-- Safe to rerun. Requires:
--   * sql/add-pointmap-date-ranges.sql
--   * sql/add-incentive-unit-reward.sql
--
-- Apply with:
--   node scripts/apply-sql.mjs sql/apply-retail-incentive-2026-07.sql

-- Special rewards are monthly programs. Date-scope them so applying July's
-- workbook does not rewrite the June report or leak July rewards into August.
ALTER TABLE app_incentive_special_reward
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT DATE '2026-01-01',
  ADD COLUMN IF NOT EXISTS effective_to date NOT NULL DEFAULT DATE '2099-12-31';

ALTER TABLE app_incentive_special_reward
  DROP CONSTRAINT IF EXISTS app_incentive_special_reward_effective_dates_check;
ALTER TABLE app_incentive_special_reward
  ADD CONSTRAINT app_incentive_special_reward_effective_dates_check
  CHECK (effective_to >= effective_from);

ALTER TABLE app_incentive_unit_reward
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT DATE '2026-01-01',
  ADD COLUMN IF NOT EXISTS effective_to date NOT NULL DEFAULT DATE '2099-12-31';

ALTER TABLE app_incentive_unit_reward
  DROP CONSTRAINT IF EXISTS app_incentive_unit_reward_effective_dates_check;
ALTER TABLE app_incentive_unit_reward
  ADD CONSTRAINT app_incentive_unit_reward_effective_dates_check
  CHECK (effective_to >= effective_from);

-- The existing department rewards came from the June workbook.
UPDATE app_incentive_special_reward
SET effective_from = DATE '2026-06-01', effective_to = DATE '2026-06-30'
WHERE reward_code IN ('HISENSE_CE', 'DEPT_CE_SDA', 'DEPT_AIR')
  AND effective_from = DATE '2026-01-01'
  AND effective_to = DATE '2099-12-31';

-- Workbook section ④. The table (not the contradictory prose above it) is
-- authoritative: >=1 set pays 100/set; >=10 sets pays 200/set.
INSERT INTO app_incentive_unit_reward
  (reward_code, description, group_code, brand_code, item_match,
   low_min_qty, low_reward, high_min_qty, high_reward, is_active,
   effective_from, effective_to)
VALUES
  ('AIR_BRAND', 'ຍອດຂາຍແອຕາມແບຮນດ໌ທີ່ກຳນົດ', 'AIR', 'MITSUBISHI', NULL,
   1, 100, 10, 200, true, DATE '2026-07-01', DATE '2026-07-31')
ON CONFLICT (reward_code) DO UPDATE SET
  description = EXCLUDED.description, group_code = EXCLUDED.group_code,
  brand_code = EXCLUDED.brand_code, item_match = EXCLUDED.item_match,
  low_min_qty = EXCLUDED.low_min_qty, low_reward = EXCLUDED.low_reward,
  high_min_qty = EXCLUDED.high_min_qty, high_reward = EXCLUDED.high_reward,
  is_active = EXCLUDED.is_active, effective_from = EXCLUDED.effective_from,
  effective_to = EXCLUDED.effective_to;

-- Workbook section ⑤. 110301-0716 is a HISENSE TV, so its eligible roster is
-- CE_SDA, not AIR. Amounts remain zero exactly as supplied in the workbook.
INSERT INTO app_incentive_unit_reward
  (reward_code, description, group_code, brand_code, item_match,
   low_min_qty, low_reward, high_min_qty, high_reward, is_active,
   effective_from, effective_to)
VALUES
  ('AIR_MODEL', 'ຍອດຂາຍຮຸ່ນທີ່ກຳນົດ', 'CE_SDA', NULL, '110301-0716',
   10, 0, 20, 0, true, DATE '2026-07-01', DATE '2026-07-31')
ON CONFLICT (reward_code) DO UPDATE SET
  description = EXCLUDED.description, group_code = EXCLUDED.group_code,
  brand_code = EXCLUDED.brand_code, item_match = EXCLUDED.item_match,
  low_min_qty = EXCLUDED.low_min_qty, low_reward = EXCLUDED.low_reward,
  high_min_qty = EXCLUDED.high_min_qty, high_reward = EXCLUDED.high_reward,
  is_active = EXCLUDED.is_active, effective_from = EXCLUDED.effective_from,
  effective_to = EXCLUDED.effective_to;

-- Workbook section ⑥: CE + AIR + SDA combined department target. The two-baht
-- difference from the target-roster sum is intentional; preserve the approved
-- workbook value literally.
INSERT INTO app_incentive_special_reward
  (reward_code, description, group_code, brand_code, target_amount,
   reward_amount, split_by_share, is_active, effective_from, effective_to)
VALUES
  ('DEPT_ALL_202607', 'ບັນລຸເປົ້າຍອດຂາຍລວມທັງພະແນກ ກໍລະກົດ 2026',
   'ALL', NULL, 11733200, 1000, false, true,
   DATE '2026-07-01', DATE '2026-07-31')
ON CONFLICT (reward_code) DO UPDATE SET
  description = EXCLUDED.description,
  group_code = EXCLUDED.group_code,
  brand_code = EXCLUDED.brand_code,
  target_amount = EXCLUDED.target_amount,
  reward_amount = EXCLUDED.reward_amount,
  split_by_share = EXCLUDED.split_by_share,
  is_active = EXCLUDED.is_active,
  effective_from = EXCLUDED.effective_from,
  effective_to = EXCLUDED.effective_to;

-- Exact July AIR points. These narrow date ranges override the long-lived base
-- rows because the report resolves the shortest matching range first.
INSERT INTO app_incentive_point_rule
  (category_code, brand_code, design_token, size_token,
   effective_from, effective_to, points, is_special)
VALUES
  ('Air', 'AUX',       'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'CARRIER',   'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'CARRIER',   'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  5.5, false),
  ('Air', 'DAIKIN',    'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  8.5, false),
  ('Air', 'DAIKIN',    'Inverter', '10001-20000', DATE '2026-07-01', DATE '2026-07-31',  9.0, false),
  ('Air', 'DAIKIN',    'Inverter', '>20000',      DATE '2026-07-01', DATE '2026-07-31', 11.0, false),
  ('Air', 'DAIKIN',    'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  6.5, false),
  ('Air', 'HISENSE',   'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31', 10.0, false),
  ('Air', 'HISENSE',   'Inverter', '10001-20000', DATE '2026-07-01', DATE '2026-07-31', 11.0, false),
  ('Air', 'HISENSE',   'Inverter', '>20000',      DATE '2026-07-01', DATE '2026-07-31', 12.5, false),
  ('Air', 'HISENSE',   'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  8.0, false),
  ('Air', 'LG',        'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'LG',        'Inverter', '10001-20000', DATE '2026-07-01', DATE '2026-07-31',  7.5, false),
  ('Air', 'MIDEA',     'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'MIDEA',     'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  5.5, false),
  ('Air', 'MIDEA',     'On-Off',   '10001-20000', DATE '2026-07-01', DATE '2026-07-31',  5.5, false),
  ('Air', 'PANASONIC', 'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31', 10.5, false),
  ('Air', 'PANASONIC', 'Inverter', '10001-20000', DATE '2026-07-01', DATE '2026-07-31', 11.5, false),
  ('Air', 'PANASONIC', 'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  8.5, false),
  ('Air', 'SAMSUNG',   'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'SAMSUNG',   'Inverter', '10001-20000', DATE '2026-07-01', DATE '2026-07-31',  7.5, false),
  ('Air', 'SAMSUNG',   'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  5.5, false),
  ('Air', 'SAMSUNG',   'On-Off',   '10001-20000', DATE '2026-07-01', DATE '2026-07-31',  5.5, false),
  ('Air', 'SHARP',     'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'TOSHIBA',   'Inverter', '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  7.0, false),
  ('Air', 'TOSHIBA',   'On-Off',   '<=10000',     DATE '2026-07-01', DATE '2026-07-31',  5.5, false)
ON CONFLICT
  (category_code, brand_code, design_token, size_token,
   effective_from, effective_to, is_special)
DO UPDATE SET points = EXCLUDED.points, updated_at = now();

-- CE/SDA workbook dated 15 July 2026. Five combinations were absent from the
-- base map. The zero-point override removes the obsolete HISENSE 1-door rule
-- for July without rewriting historical months.
INSERT INTO app_incentive_point_rule
  (category_code, brand_code, design_token, size_token,
   effective_from, effective_to, points, is_special)
VALUES
  ('REF', 'LG',      '1 Door', '5.0-9.9', DATE '2026-07-01', DATE '2026-07-31', 3,    false),
  ('REF', 'SAMSUNG', '1 Door', '5.0-9.9', DATE '2026-07-01', DATE '2026-07-31', 3,    false),
  ('REF', 'HISENSE', '1 Door', '5.0-9.9', DATE '2026-07-01', DATE '2026-07-31', 0,    false),
  ('SDA', 'HATARI',  'OTH',    '<=2000',  DATE '2026-07-01', DATE '2026-07-31', 0.5,  false),
  ('SDA', 'HATARI',  'OTH',    '<=5000',  DATE '2026-07-01', DATE '2026-07-31', 1.25, false),
  ('SDA', 'HATARI',  'OTH',    '>5000',   DATE '2026-07-01', DATE '2026-07-31', 1.5,  false)
ON CONFLICT
  (category_code, brand_code, design_token, size_token,
   effective_from, effective_to, is_special)
DO UPDATE SET points = EXCLUDED.points, updated_at = now();

-- Product promotion statuses are also monthly. Convert the former single-row
-- table to dated rules, retain its old entries for Jan-Jun, then load the exact
-- 53-item July snapshot from the new workbook.
ALTER TABLE app_incentive_product_status
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT DATE '2026-01-01',
  ADD COLUMN IF NOT EXISTS effective_to date NOT NULL DEFAULT DATE '2099-12-31';

ALTER TABLE app_incentive_product_status
  DROP CONSTRAINT IF EXISTS app_incentive_product_status_effective_dates_check;
ALTER TABLE app_incentive_product_status
  ADD CONSTRAINT app_incentive_product_status_effective_dates_check
  CHECK (effective_to >= effective_from);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_incentive_product_status'::regclass
      AND contype = 'p'
      AND cardinality(conkey) = 1
  ) THEN
    ALTER TABLE app_incentive_product_status
      DROP CONSTRAINT app_incentive_product_status_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_incentive_product_status'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE app_incentive_product_status
      ADD CONSTRAINT app_incentive_product_status_pkey
      PRIMARY KEY (item_code, effective_from);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_incentive_product_status_period_idx
  ON app_incentive_product_status (item_code, effective_from, effective_to);

UPDATE app_incentive_product_status
SET effective_to = DATE '2026-06-30'
WHERE effective_from = DATE '2026-01-01'
  AND effective_to = DATE '2099-12-31';

INSERT INTO app_incentive_product_status
  (item_code, status_code, weight, note, effective_from, effective_to)
VALUES
  ('110301-0724','special_no_bonus',0,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0739','special_no_bonus',0,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0756','special_no_bonus',0,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0754','special_no_bonus',0,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0761','special_no_bonus',0,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0736','special_no_bonus',0,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0765','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0776','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0716','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0723','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0721','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0735','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110302-0381','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0421','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0767','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0725','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0465','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0768','special_min_bonus',0.5,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0713','special_promo_max',1.2,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110301-0773','special_promo_max',1.2,'July 2026 AV workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110101-1123','special_no_bonus',0,'July 2026 REF workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110101-1134','special_no_bonus',0,'July 2026 REF workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110104-0590','special_no_bonus',0,'July 2026 Washer workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110104-0580','special_no_bonus',0,'July 2026 Washer workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110104-0560','special_no_bonus',0,'July 2026 Washer workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110104-0512','special_no_bonus',0,'July 2026 Washer workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110104-0541','special_promo_max',1.2,'July 2026 Washer workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0849','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0927','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110401-0219','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110201-0610','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110201-0609','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0329','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0914','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0883','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0363','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0931','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0433','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0818','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0937','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0528','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0529','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0549','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110206-0216','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110105-0207','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110105-0209','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110105-0213','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0923','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110202-0330','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110202-0329','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110204-0203','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110403-0367','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31'),
  ('110205-0785','special_no_bonus',0,'July 2026 SDA workbook',DATE '2026-07-01',DATE '2026-07-31')
ON CONFLICT (item_code, effective_from) DO UPDATE SET
  status_code = EXCLUDED.status_code,
  weight = EXCLUDED.weight,
  note = EXCLUDED.note,
  effective_to = EXCLUDED.effective_to,
  updated_at = now();

-- Keep dated history separate from the legacy/current table. The deployed
-- application version still joins app_incentive_product_status by item_code
-- only, so that table must contain at most one row per item until the new code
-- is deployed.
CREATE TABLE IF NOT EXISTS app_incentive_product_status_rule (
  item_code varchar(50) NOT NULL,
  status_code varchar(40) NOT NULL DEFAULT 'current',
  weight numeric(8,4) NOT NULL DEFAULT 1,
  note text,
  effective_from date NOT NULL,
  effective_to date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_code, effective_from),
  CHECK (effective_to >= effective_from)
);

INSERT INTO app_incentive_product_status_rule
  (item_code, status_code, weight, note, effective_from, effective_to, updated_at)
SELECT item_code, status_code, weight, note, effective_from, effective_to, updated_at
FROM app_incentive_product_status
ON CONFLICT (item_code, effective_from) DO UPDATE SET
  status_code = EXCLUDED.status_code, weight = EXCLUDED.weight,
  note = EXCLUDED.note, effective_to = EXCLUDED.effective_to,
  updated_at = EXCLUDED.updated_at;

DELETE FROM app_incentive_product_status
WHERE NOT (CURRENT_DATE BETWEEN effective_from AND effective_to);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_incentive_product_status'::regclass
      AND contype = 'p' AND cardinality(conkey) <> 1
  ) THEN
    ALTER TABLE app_incentive_product_status
      DROP CONSTRAINT app_incentive_product_status_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app_incentive_product_status'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE app_incentive_product_status
      ADD CONSTRAINT app_incentive_product_status_pkey PRIMARY KEY (item_code);
  END IF;
END $$;
