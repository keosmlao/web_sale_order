-- ============================================================================
-- ODG_SALE — Indexes for all legacy tables touched by the app.
-- Run as a DB admin. Each statement is idempotent (`IF NOT EXISTS`).
-- Run ANALYZE after creating indexes so the planner picks them up.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ic_trans — sales transactions (large table, scanned by daily-sales report)
-- ----------------------------------------------------------------------------

-- Main filter: doc_date is most selective for date-range queries.
CREATE INDEX IF NOT EXISTS idx_ic_trans_daily_sales
  ON ic_trans (doc_date, trans_flag, department_code);

-- Used when joining ic_trans → odg_employee by sale_code.
CREATE INDEX IF NOT EXISTS idx_ic_trans_sale_code
  ON ic_trans (sale_code);

-- Used when joining ic_trans → ar_customer by cust_code.
CREATE INDEX IF NOT EXISTS idx_ic_trans_cust_code
  ON ic_trans (cust_code);

-- Cashier order list: WHERE doc_format_code='SOK' ORDER BY create_date_time_now
-- DESC LIMIT 200 (getCashierData). Without this the query full-scans + sorts
-- the whole table and times out. See sql/add-cashier-order-index.sql.
CREATE INDEX IF NOT EXISTS idx_ic_trans_sok_recent
  ON ic_trans (doc_format_code, create_date_time_now DESC);

-- ----------------------------------------------------------------------------
-- odg_employee — staff, used on every authenticated request (layout calls
-- requireEmployee → findUnique by employee_code).
-- employee_code is @unique in Prisma so an index should exist; this is a safety net.
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_odg_employee_employee_code
  ON odg_employee (employee_code);

CREATE INDEX IF NOT EXISTS idx_odg_employee_department_code
  ON odg_employee (department_code);

-- ----------------------------------------------------------------------------
-- ar_customer / ar_customer_detail / ar_group_sub — members page
-- (these were defined in members-indexes.sql; repeated here so this file is
-- self-contained for fresh setups)
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ar_customer_reg_group_lower
  ON ar_customer ((LOWER(TRIM(COALESCE(reg_group, '')))));

-- Make the LIKE-based search on customer code/name index-aided. The members
-- page does `LOWER(ar.code) LIKE '%q%'` etc.; trigram indexes work for that.
-- Requires the pg_trgm extension (CREATE EXTENSION IF NOT EXISTS pg_trgm;).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_ar_customer_code_trgm
  ON ar_customer USING gin (LOWER(code) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ar_customer_name_trgm
  ON ar_customer USING gin (LOWER(name_1) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ar_customer_telephone_trgm
  ON ar_customer USING gin (LOWER(telephone) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ar_customer_code
  ON ar_customer (code);

CREATE INDEX IF NOT EXISTS idx_ar_customer_detail_ar_code
  ON ar_customer_detail (ar_code);

CREATE INDEX IF NOT EXISTS idx_ar_group_sub_code
  ON ar_group_sub (code);

-- ic_inventory_price — used by /api/inventory to find the latest KIP price per item.
CREATE INDEX idx_ic_inventory_price_ic_code
  ON ic_inventory_price (ic_code);

CREATE INDEX idx_ic_inventory_price_kip_active
  ON ic_inventory_price (ic_code)
  WHERE currency_code = '02'
    AND COALESCE(sale_price1, 0) > 0
    AND COALESCE(status, 1) = 1;

-- Join keys used by the inventory listing.
CREATE INDEX idx_ic_brand_code    ON ic_brand    (code);
CREATE INDEX idx_ic_category_code ON ic_category (code);
CREATE INDEX idx_ic_group_code    ON ic_group    (code);

-- ----------------------------------------------------------------------------
-- order_cart / order_item / ic_inventory / ic_warehouse — cashier page
-- (the cashier list joins these per cart with correlated subqueries; without
-- the cart_number index every subquery scans order_item).
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_order_item_cart_number
  ON order_item (cart_number, roworder);

CREATE INDEX IF NOT EXISTS idx_order_item_item_code
  ON order_item (item_code);

CREATE INDEX IF NOT EXISTS idx_ic_inventory_code
  ON ic_inventory (code);

CREATE INDEX IF NOT EXISTS idx_ic_warehouse_code
  ON ic_warehouse (code);

CREATE INDEX IF NOT EXISTS idx_order_cart_create_date_time
  ON order_cart (create_date_time_now DESC);

-- ----------------------------------------------------------------------------
-- odg_sale_detail — denormalized sales sheet (~510k rows), scanned ~10x per
-- home-dashboard load. Front-store cards filter branch_code='01' AND
-- argroup_main='101' + a doc_date range (often + salename IN (...)). A PARTIAL
-- composite index on that predicate replaces a ~1.2s Seq Scan with a tiny
-- index range scan. See sql/add-dashboard-indexes.sql.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_osd_frontstore
  ON odg_sale_detail (doc_date, salename)
  WHERE branch_code = '01' AND argroup_main = '101';

-- ----------------------------------------------------------------------------
-- ic_inventory_price — POS catalog price lookup. The /api/products query does
-- SELECT DISTINCT ON (ic_code) over ~750k rows filtered to the active kip
-- prices. A partial index on ic_code (active kip rows only) removes the ~143k
-- full sort. See sql/add-pos-catalog-index.sql.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_icprice_active_code
  ON ic_inventory_price (ic_code)
  WHERE currency_code = '02'
    AND COALESCE(sale_price1, 0) > 0
    AND COALESCE(status, 1) = 1;

-- ----------------------------------------------------------------------------
-- After running this file, refresh planner statistics.
-- (You can run these one at a time if the lock impact matters.)
-- ----------------------------------------------------------------------------
-- ANALYZE ic_trans;
-- ANALYZE odg_employee;
-- ANALYZE ar_customer;
-- ANALYZE ar_customer_detail;
-- ANALYZE ar_group_sub;
