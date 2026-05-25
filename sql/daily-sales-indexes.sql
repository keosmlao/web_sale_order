-- Run on the database that backs ODG_SALE to make /reports/daily-sales fast.
-- The page filters ic_trans by (trans_flag, doc_date, department_code) and
-- doc_no prefix, then joins to odg_employee and ar_customer.

-- 1) Main filter: most selective columns first. doc_date alone usually narrows
--    to a tiny slice (a single day), trans_flag + department_code further trim it.
CREATE INDEX IF NOT EXISTS idx_ic_trans_daily_sales
  ON ic_trans (doc_date, trans_flag, department_code);

-- 2) Join from base.sale_code → odg_employee.employee_code
CREATE INDEX IF NOT EXISTS idx_odg_employee_employee_code
  ON odg_employee (employee_code);

-- 3) Join from base.cust_code → ar_customer.code
--    (ar_customer.code may already be a PK — this is a no-op in that case)
CREATE INDEX IF NOT EXISTS idx_ar_customer_code
  ON ar_customer (code);

-- After creating the indexes, run ANALYZE so the planner picks them up:
-- ANALYZE ic_trans;
-- ANALYZE odg_employee;
-- ANALYZE ar_customer;
