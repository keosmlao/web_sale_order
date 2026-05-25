-- Tracks who cancelled / reopened each order_cart, with optional reason.
-- Append-only — never DELETE/UPDATE rows so the audit trail stays intact.
-- Keyed by cart_number (string FK to order_cart). We do NOT add a real FK
-- constraint because legacy order_cart rows may be removed/migrated outside
-- this app — keeping it soft means deleting a cart doesn't break audit.

CREATE TABLE IF NOT EXISTS app_order_audit (
  id            BIGSERIAL PRIMARY KEY,
  cart_number   VARCHAR(5)   NOT NULL,
  action        VARCHAR(20)  NOT NULL,    -- 'cancel' | 'reopen'
  actor_code    VARCHAR(20)  NOT NULL,    -- odg_employee.employee_code
  reason        TEXT,                     -- optional free-text
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_order_audit_cart
  ON app_order_audit (cart_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_order_audit_created
  ON app_order_audit (created_at DESC);
