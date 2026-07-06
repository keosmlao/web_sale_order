-- ============================================================================
-- Make the monthly commission pay-rate rule configurable instead of hard-coded.
-- Adds three knobs to app_incentive_config (was hard-coded in route.ts):
--   commission_min_pct    : achievement below this earns 0 commission   (was 0.80)
--   commission_round_step : rounding granularity of the pay rate         (was 0.05)
--   commission_pivot_pct  : below → round DOWN, at/above → round UP       (was 1.00)
-- The rate = achievement rounded to the step (floor below the pivot, ceil
-- at/above it), and 0 below the minimum.
--
-- Run:  node scripts/apply-sql.mjs sql/add-incentive-commission-rule.sql
-- Idempotent: safe to re-run.
-- ============================================================================
ALTER TABLE app_incentive_config
  ADD COLUMN IF NOT EXISTS commission_min_pct    numeric(8,4) NOT NULL DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS commission_round_step numeric(8,4) NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS commission_pivot_pct  numeric(8,4) NOT NULL DEFAULT 1.00;
