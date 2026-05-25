-- Run on the database that backs ODG_SALE to make the /members page fast.
-- Without these indexes every page load scans ar_customer and joins detail/group_sub
-- without index support, which is the main cause of slow navigation.

-- 1) reg_group filter: 'member' is highly selective if there are many non-members.
CREATE INDEX IF NOT EXISTS idx_ar_customer_reg_group_lower
  ON ar_customer ((LOWER(TRIM(COALESCE(reg_group, '')))));

-- 2) Detail join: ar_customer_detail.ar_code is the join key from ar_customer.code.
CREATE INDEX IF NOT EXISTS idx_ar_customer_detail_ar_code
  ON ar_customer_detail (ar_code);

-- 3) Group sub join: ar_group_sub.code is the join key from detail.group_sub_1.
CREATE INDEX IF NOT EXISTS idx_ar_group_sub_code
  ON ar_group_sub (code);

-- After creating the indexes, run ANALYZE so the planner picks them up:
-- ANALYZE ar_customer;
-- ANALYZE ar_customer_detail;
-- ANALYZE ar_group_sub;
