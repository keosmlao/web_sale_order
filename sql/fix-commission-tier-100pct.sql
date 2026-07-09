-- ============================================================================
-- The 100.0–100.9% commission tier pays the base rate exactly: 100%.
-- Example for seller base 6,000:
--   100.5557% achievement -> rate 100.0000% -> 6,000
-- It must NOT use the raw exact percentage, and must NOT round up to 105%.
--
-- Sets the from_pct = 1.00 tier to round DOWN by 1% for all three positions
-- (13 seller / 11 manager / 12 head), so 100.x floors to 100%.
-- Idempotent.
--
-- Run:  node scripts/apply-sql.mjs sql/fix-commission-tier-100pct.sql
-- ============================================================================
UPDATE app_incentive_commission_tier
SET mode = 'round_down',
    round_step = 0.01
WHERE from_pct = 1.0000
  AND (mode <> 'round_down' OR round_step <> 0.01);
