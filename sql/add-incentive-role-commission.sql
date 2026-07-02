-- ============================================================================
-- Commission bases for MANAGER (position 11) and UNIT HEAD (position 12) —
-- per product group, paid on the TEAM's achievement % of that group (same
-- <80%→0 / 80–99%→floor-5% / ≥100%→ceil-5% rate rule as the sellers).
--
-- From the workbook:
--   position        CE+SDA   AIR    CE+SDA+AIR (ALL)   ONLINE
--   ພະນັກງານຂາຍ (13) 6,000   6,000   —                 5,000
--   ຜູ້ຈັດການ (11)    4,500   2,500   3,000              —
--   ຫົວໜ້າ (12)      4,000   3,000   3,000              —
-- Sellers are paid on their PERSONAL achievement with the base of their own
-- group; managers/heads on the TEAM's achievement per group. The ONLINE row
-- is stored for completeness but unused until an online channel exists.
-- (app_incentive_config.commission_base stays as the fallback when a seller's
-- group has no row here.)
--
-- Run:  node scripts/apply-sql.mjs sql/add-incentive-role-commission.sql
-- Idempotent: re-running refreshes the seeded amounts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_incentive_role_commission (
  id            SERIAL PRIMARY KEY,
  position_code TEXT NOT NULL,   -- odg_employee.position_code: '11' | '12'
  group_code    TEXT NOT NULL,   -- 'CE_SDA' | 'AIR' | 'ALL'
  base_amount   NUMERIC NOT NULL,
  UNIQUE (position_code, group_code)
);

INSERT INTO app_incentive_role_commission (position_code, group_code, base_amount)
VALUES
  ('13', 'CE_SDA', 6000),
  ('13', 'AIR',    6000),
  ('13', 'ONLINE', 5000),
  ('11', 'CE_SDA', 4500),
  ('11', 'AIR',    2500),
  ('11', 'ALL',    3000),
  ('12', 'CE_SDA', 4000),
  ('12', 'AIR',    3000),
  ('12', 'ALL',    3000)
ON CONFLICT (position_code, group_code)
DO UPDATE SET base_amount = EXCLUDED.base_amount;
