-- Channel that created each sales order: 'web' (browser POS) or 'app' (the
-- Flutter sales app). The legacy ic_trans table has no such column, so this
-- app-owned sidecar is keyed by cart_number (the MMSSSS suffix of doc_no,
-- shared across the app_* tables). Written once at order creation and read
-- back via LEFT JOIN in /api/orders and /api/cashier/history.

CREATE TABLE IF NOT EXISTS app_order_source (
  cart_number  VARCHAR(20)  PRIMARY KEY,
  source       VARCHAR(10)  NOT NULL,
  doc_no       VARCHAR(25),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
