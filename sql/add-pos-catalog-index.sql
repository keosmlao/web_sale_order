-- ============================================================================
-- POS catalog — speed up /api/products (the sales-page product load).
--
-- WHY: the catalog query builds a `latest_price` CTE with
--   SELECT DISTINCT ON (ic_code) ... FROM ic_inventory_price
--   WHERE currency_code='02' AND sale_price1>0 AND status=1
--   ORDER BY ic_code, <date exprs> DESC
-- ic_inventory_price has ~750k rows and no index matching that filter, so
-- Postgres parallel-seq-scans the whole table (→ ~143k rows) and sorts all of
-- them (~15 MB) for the DISTINCT ON — ~0.9s on every sales-page open.
--
-- A PARTIAL index on ic_code (only the active kip price rows) lets the planner
-- read those rows already ordered by ic_code, so the DISTINCT ON becomes a
-- cheap incremental sort instead of one big 143k-row sort.
--
-- (The route also now caches the mapped result for 60s, so most opens skip the
-- query entirely; this index makes the cache-miss / first load fast too.)
--
-- Run:  node scripts/apply-sql.mjs sql/add-pos-catalog-index.sql
-- Idempotent (IF NOT EXISTS).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_icprice_active_code
  ON ic_inventory_price (ic_code)
  WHERE currency_code = '02'
    AND COALESCE(sale_price1, 0) > 0
    AND COALESCE(status, 1) = 1;

ANALYZE ic_inventory_price;
