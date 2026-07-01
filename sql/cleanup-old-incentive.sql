-- Remove the leftover tables from the original weight-based incentive model
-- (add-sales-incentive.sql). The current point-based report (add-incentive-point-map.sql +
-- /api/reports/incentives) does NOT use any of these — brand weights and GP tiers are gone,
-- and monthly targets come from odg_retail_target_employee, not app_incentive_target.
-- Safe to run once. Idempotent.

DROP TABLE IF EXISTS app_incentive_brand_weight;
DROP TABLE IF EXISTS app_incentive_gp_tier;
DROP TABLE IF EXISTS app_incentive_target;
