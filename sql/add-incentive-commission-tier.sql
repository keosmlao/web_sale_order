-- ============================================================================
-- Per-position commission-rate TIERS (replaces the fixed min/step/pivot knobs).
-- Each position (13 ພະນັກງານຂາຍ / 11 ຜູ້ຈັດການ / 12 ຫົວໜ້າ) has its own ordered
-- list of tiers. A given achievement % falls into the tier with the greatest
-- from_pct that is ≤ the achievement; that tier's mode decides the pay rate:
--   zero        → 0
--   round_down  → achievement rounded DOWN to round_step
--   round_up    → achievement rounded UP to round_step
--   exact       → the achievement % itself, no rounding
-- Below the lowest tier → 0.
--
-- Run:  node scripts/apply-sql.mjs sql/add-incentive-commission-tier.sql
-- Idempotent: table + seed are safe to re-run (seed only fills empty positions).
-- ============================================================================
CREATE TABLE IF NOT EXISTS app_incentive_commission_tier (
  id            BIGSERIAL PRIMARY KEY,
  position_code TEXT NOT NULL,                       -- '13' | '11' | '12'
  from_pct      numeric(8,4) NOT NULL,               -- lower bound (inclusive), fraction e.g. 0.80
  mode          TEXT NOT NULL DEFAULT 'round_down'
                CHECK (mode IN ('zero', 'round_down', 'round_up', 'exact')),
  round_step    numeric(8,4) NOT NULL DEFAULT 0.05,  -- used by round_down / round_up
  UNIQUE (position_code, from_pct)
);

CREATE INDEX IF NOT EXISTS idx_incentive_commission_tier_pos
  ON app_incentive_commission_tier (position_code, from_pct);

-- Seed each position with the original hard-coded rule (0 / 80%↓5% / 100%↑5%),
-- but only where that position has no tiers yet, so re-running never clobbers
-- edits.
INSERT INTO app_incentive_commission_tier (position_code, from_pct, mode, round_step)
SELECT p.position_code, t.from_pct, t.mode, t.round_step
FROM (VALUES ('13'), ('11'), ('12')) AS p(position_code)
CROSS JOIN (VALUES
  (0.00, 'zero',       0.05),
  (0.80, 'round_down', 0.05),
  (1.00, 'round_up',   0.05)
) AS t(from_pct, mode, round_step)
WHERE NOT EXISTS (
  SELECT 1 FROM app_incentive_commission_tier x WHERE x.position_code = p.position_code
);
