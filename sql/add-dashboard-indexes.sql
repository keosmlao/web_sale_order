-- ============================================================================
-- Home dashboard — index odg_sale_detail for the front-store sales cards.
--
-- WHY: the home page (src/app/(app)/page.tsx) runs ~10 aggregate queries over
-- odg_sale_detail on every load. The table has ~510k rows and NO usable index,
-- so each query did a parallel Seq Scan (~226k pages / ~1.8 GB, ~1.2 s each)
-- just to find the handful of front-store rows for the period. Ten of those in
-- parallel = a multi-second dashboard.
--
-- Every dashboard query filters `branch_code='01' AND argroup_main='101'`
-- (front-store) and a doc_date range, often plus `salename IN (...)`. A PARTIAL
-- composite index on exactly that predicate turns the Seq Scan into a tiny
-- index range scan (front-store is a small fraction of the table).
--
-- Run:  node scripts/apply-sql.mjs sql/add-dashboard-indexes.sql
-- Then the planner needs fresh stats:  it runs ANALYZE below automatically.
-- Idempotent (IF NOT EXISTS).
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_osd_frontstore
  ON odg_sale_detail (doc_date, salename)
  WHERE branch_code = '01' AND argroup_main = '101';

ANALYZE odg_sale_detail;
