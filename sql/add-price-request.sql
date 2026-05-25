-- Per-item special-price requests submitted by salespeople and decided by
-- managers. While status='pending' the corresponding order_item still uses
-- the ORIGINAL price — the override only kicks in when status='approved'.
-- This keeps order_cart.amount honest for cashier settlement.

CREATE TABLE IF NOT EXISTS app_price_request (
  id               BIGSERIAL PRIMARY KEY,
  cart_number      VARCHAR(5)   NOT NULL,
  item_code        VARCHAR(50)  NOT NULL,
  original_price   NUMERIC(18,4) NOT NULL,
  requested_price  NUMERIC(18,4) NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
                                -- 'pending' | 'approved' | 'rejected'
  requestor_code   VARCHAR(20)  NOT NULL,
  approver_code    VARCHAR(20),
  reason           TEXT,
  approver_note    TEXT,
  requested_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  decided_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_price_request_status
  ON app_price_request (status, requested_at);

CREATE INDEX IF NOT EXISTS idx_app_price_request_cart
  ON app_price_request (cart_number, item_code);
