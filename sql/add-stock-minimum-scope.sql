-- Aggregate sales warehouses into a single "sales_agg" rule per item.
--
-- Before: 1 rule per (warehouse, item). 5 sales warehouses with the same
-- item meant 5 separate rules and 5 separate watchlist rows.
-- After: rules for sales warehouses collapse into ONE per item with
-- warehouse_code = '' (sentinel) and scope = 'sales_agg'. The watchlist
-- compares aggregate stock (sum across sales warehouses) against this
-- single threshold. Non-sales warehouses keep per-warehouse rules.
--
-- Refill requests that target the aggregate scope have warehouse_code = NULL
-- (a "general" request not tied to a specific warehouse).
--
-- Safe to run repeatedly: re-running collapses any new per-warehouse rules
-- that were created in sales warehouses since the last run.

-- 1) Add scope column to app_stock_minimum.
ALTER TABLE app_stock_minimum
  ADD COLUMN IF NOT EXISTS scope VARCHAR(20) NOT NULL DEFAULT 'warehouse';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'app_stock_minimum'
      AND constraint_name = 'app_stock_minimum_scope_chk'
  ) THEN
    ALTER TABLE app_stock_minimum
      ADD CONSTRAINT app_stock_minimum_scope_chk
      CHECK (scope IN ('warehouse', 'sales_agg'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_stock_minimum_scope
  ON app_stock_minimum (scope, item_code);

-- 2) Collapse per-warehouse rules in sales warehouses into one sales_agg
--    rule per item. SUM threshold values; MAX cover_days (a policy field,
--    not an additive amount). Keep the latest updater + non-empty note.
INSERT INTO app_stock_minimum (
  warehouse_code, item_code, scope,
  min_qty, target_qty, daily_sales_qty, cover_days, safety_qty,
  note, updated_by, updated_at
)
SELECT
  '' AS warehouse_code,
  sm.item_code,
  'sales_agg' AS scope,
  SUM(sm.min_qty),
  SUM(sm.target_qty),
  SUM(sm.daily_sales_qty),
  MAX(sm.cover_days),
  SUM(sm.safety_qty),
  (ARRAY_AGG(sm.note ORDER BY sm.updated_at DESC)
     FILTER (WHERE sm.note IS NOT NULL AND sm.note <> ''))[1],
  (ARRAY_AGG(sm.updated_by ORDER BY sm.updated_at DESC)
     FILTER (WHERE sm.updated_by IS NOT NULL))[1],
  MAX(sm.updated_at)
FROM app_stock_minimum sm
JOIN app_sales_warehouse sw
  ON sw.warehouse_code = sm.warehouse_code
 AND sw.is_active = TRUE
WHERE sm.scope = 'warehouse'
GROUP BY sm.item_code
ON CONFLICT (warehouse_code, item_code) DO NOTHING;

-- 3) Remove the now-redundant per-warehouse rules from sales warehouses.
DELETE FROM app_stock_minimum sm
USING app_sales_warehouse sw
WHERE sw.warehouse_code = sm.warehouse_code
  AND sw.is_active = TRUE
  AND sm.scope = 'warehouse';

-- 4) Allow refill requests to be created without a specific warehouse
--    (warehouse_code = NULL means "general / sales aggregate").
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_stock_refill_request'
      AND column_name = 'warehouse_code'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE app_stock_refill_request
      ALTER COLUMN warehouse_code DROP NOT NULL;
  END IF;
END $$;

-- 5) Partial unique index so only ONE pending/approved general request can
--    exist per item. The existing composite index still handles the
--    per-warehouse case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_stock_refill_request_general_open
  ON app_stock_refill_request (item_code)
  WHERE warehouse_code IS NULL AND status IN ('pending', 'approved');
