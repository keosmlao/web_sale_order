-- Sales warehouse and minimum-stock settings for the app/POS.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS app_sales_warehouse (
  warehouse_code varchar(25) PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  updated_by varchar(20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_sales_warehouse_active
  ON app_sales_warehouse (is_active, warehouse_code);

CREATE TABLE IF NOT EXISTS app_stock_minimum (
  id bigserial PRIMARY KEY,
  warehouse_code varchar(25) NOT NULL,
  item_code varchar(50) NOT NULL,
  min_qty numeric(18, 4) NOT NULL DEFAULT 0,
  target_qty numeric(18, 4) NOT NULL DEFAULT 0,
  daily_sales_qty numeric(18, 4) NOT NULL DEFAULT 0,
  cover_days numeric(18, 4) NOT NULL DEFAULT 0,
  safety_qty numeric(18, 4) NOT NULL DEFAULT 0,
  note text,
  updated_by varchar(20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_stock_minimum_unique UNIQUE (warehouse_code, item_code)
);

CREATE INDEX IF NOT EXISTS idx_app_stock_minimum_item
  ON app_stock_minimum (item_code);

CREATE INDEX IF NOT EXISTS idx_app_stock_minimum_warehouse
  ON app_stock_minimum (warehouse_code);

