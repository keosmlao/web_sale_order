-- Back-fill columns the incentives report expects but that older runs of the
-- incentive migrations may not have created. `CREATE TABLE IF NOT EXISTS` does
-- not add columns to a table that already exists, so a table created by an
-- earlier version of add-incentive-point-map.sql can be missing newer columns.
-- All ALTERs are idempotent.
--
-- Fixes:
--   * column "commission_base" does not exist (app_incentive_config) — the
--     report's commission pay-rate calc; route defaults to 6000, so match that.
--   * column "is_active" does not exist (app_incentive_special_reward) — the
--     report filters WHERE is_active; default false (rewards enabled per-row).
--
-- Apply:  node scripts/apply-sql.mjs sql/add-incentive-commission-base.sql

ALTER TABLE app_incentive_config
  ADD COLUMN IF NOT EXISTS commission_base numeric(18,4) NOT NULL DEFAULT 6000;

ALTER TABLE app_incentive_special_reward
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;
