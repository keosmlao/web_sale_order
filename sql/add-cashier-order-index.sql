-- ============================================================================
-- Cashier order list — index for getCashierData() in
-- src/app/(app)/cashier/actions.ts.
--
-- That query does:
--     SELECT ... FROM ic_trans t
--     WHERE t.doc_format_code = 'SOK'
--     ORDER BY t.create_date_time_now DESC
--     LIMIT 200
--
-- ic_trans is large and had no index on doc_format_code or create_date_time_now,
-- so the query fell back to a full sequential scan + sort of the whole table
-- (30s "Query read timeout" when entering the cashier page). This composite
-- index lets Postgres range-scan the SOK rows already in create_date_time_now
-- DESC order and stop after LIMIT 200.
--
-- CONCURRENTLY = builds without locking writes on the live table. It must run
-- outside a transaction; the apply-sql runner sends this single statement in
-- autocommit, so that's fine. Idempotent via IF NOT EXISTS.
--
-- Apply:  node scripts/apply-sql.mjs sql/add-cashier-order-index.sql
-- Then:   ANALYZE ic_trans;   (so the planner picks up the new index)
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ic_trans_sok_recent
  ON ic_trans (doc_format_code, create_date_time_now DESC);
