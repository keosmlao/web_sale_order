-- POS feature foundation tables (Phase A of POS Improvements plan).
-- Adds: loyalty redemption history, held-bill sidecar, shift management,
-- settle audit (used by void/return + shift reconciliation), and
-- override_type tag on app_price_request for inline register overrides.
--
-- Safe to re-run: every CREATE uses IF NOT EXISTS and each ALTER guards on
-- column existence. Existing data is not touched.

-- 1. Loyalty redemption history.
--    One row per redeem-points-for-discount action at settle time.
--    Mirrored on receipt void: row stays in place; balance restored via
--    ar_customer.point_balance UPDATE in the void flow.
CREATE TABLE IF NOT EXISTS app_loyalty_redemption (
  id            BIGSERIAL    PRIMARY KEY,
  doc_no        VARCHAR(20)  NOT NULL,
  cart_number   VARCHAR(20)  NOT NULL,
  customer_code VARCHAR(50)  NOT NULL,
  points_used   INTEGER      NOT NULL CHECK (points_used > 0),
  kip_value     NUMERIC(18, 2) NOT NULL,
  cashier_code  VARCHAR(20)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_loyalty_redemption_customer
  ON app_loyalty_redemption (customer_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_loyalty_redemption_doc
  ON app_loyalty_redemption (doc_no);

-- 2. Held-bill sidecar. ic_trans.status stays at 0 (pending) — the existence
--    of a row here is what marks the SOK as "parked" so the cashier list
--    filter can separate held bills from incoming orders.
CREATE TABLE IF NOT EXISTS app_held_cart (
  cart_number   VARCHAR(20)  PRIMARY KEY,
  doc_no        VARCHAR(20)  NOT NULL,
  held_by       VARCHAR(20)  NOT NULL,
  reason        TEXT,
  held_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_held_cart_held_at
  ON app_held_cart (held_at DESC);

-- 3. Cashier shift. One open row per cashier; everything settled while
--    the row is open binds to it via app_settle_audit.shift_id for the
--    end-of-shift X/Z reconciliation.
CREATE TABLE IF NOT EXISTS app_cashier_shift (
  id             BIGSERIAL    PRIMARY KEY,
  cashier_code   VARCHAR(20)  NOT NULL,
  branch_code    VARCHAR(20),
  opened_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ,
  opening_cash   NUMERIC(18, 2) NOT NULL DEFAULT 0,
  closing_cash   NUMERIC(18, 2),
  expected_cash  NUMERIC(18, 2),
  variance       NUMERIC(18, 2),
  note           TEXT,
  status         VARCHAR(20)  NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_app_cashier_shift_open
  ON app_cashier_shift (cashier_code, status)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_app_cashier_shift_opened
  ON app_cashier_shift (opened_at DESC);

-- 4. Cash movements during a shift (drop / payout / adjustment).
--    Signed amount: positive = cash in, negative = cash out.
CREATE TABLE IF NOT EXISTS app_cash_movement (
  id             BIGSERIAL    PRIMARY KEY,
  shift_id       BIGINT       NOT NULL REFERENCES app_cashier_shift(id) ON DELETE CASCADE,
  movement_type  VARCHAR(20)  NOT NULL,
  amount         NUMERIC(18, 2) NOT NULL,
  reason         TEXT         NOT NULL,
  actor_code     VARCHAR(20)  NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_cash_movement_shift
  ON app_cash_movement (shift_id, created_at);

-- 5. Settle audit. One row per CAKAP. Cashier ID + payment split + shift
--    binding lets the shift close report reconcile expected vs counted
--    cash without scanning ic_trans. void_* fields are populated when
--    the receipt is later voided (Phase E).
CREATE TABLE IF NOT EXISTS app_settle_audit (
  id            BIGSERIAL    PRIMARY KEY,
  doc_no        VARCHAR(20)  NOT NULL UNIQUE,
  cart_number   VARCHAR(20)  NOT NULL,
  shift_id      BIGINT       REFERENCES app_cashier_shift(id) ON DELETE SET NULL,
  cashier_code  VARCHAR(20)  NOT NULL,
  total_kip     NUMERIC(18, 2) NOT NULL,
  cash_kip      NUMERIC(18, 2) NOT NULL DEFAULT 0,
  transfer_kip  NUMERIC(18, 2) NOT NULL DEFAULT 0,
  redeemed_kip  NUMERIC(18, 2) NOT NULL DEFAULT 0,
  promo_kip     NUMERIC(18, 2) NOT NULL DEFAULT 0,
  is_voided     BOOLEAN      NOT NULL DEFAULT FALSE,
  voided_at     TIMESTAMPTZ,
  voided_by     VARCHAR(20),
  void_doc_no   VARCHAR(20),
  void_reason   TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_settle_audit_shift
  ON app_settle_audit (shift_id);

CREATE INDEX IF NOT EXISTS idx_app_settle_audit_cashier
  ON app_settle_audit (cashier_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_settle_audit_voided
  ON app_settle_audit (is_voided, created_at DESC);

-- 6. override_type tag on app_price_request. Distinguishes between
--    standalone item-price requests (NULL) vs. inline register overrides
--    flagged at settle time. Values: 'line_discount', 'bill_discount',
--    'walkin_high_value'. Existing rows stay NULL — backward compatible.
ALTER TABLE app_price_request
  ADD COLUMN IF NOT EXISTS override_type VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_app_price_request_override
  ON app_price_request (override_type)
  WHERE override_type IS NOT NULL;

-- 7. Manager PIN on odg_employee for register-side override flow.
--    Stores a bcrypt-style hash; NULL means "fall back to login password".
--    Set via the employees management UI (Phase C).
ALTER TABLE odg_employee
  ADD COLUMN IF NOT EXISTS pos_pin_hash VARCHAR(200);

-- 8. Barcode-to-item mapping for in-store scanner lookups (Phase D).
--    Separate table because one item may have multiple barcodes (case
--    pack, inner unit, etc.). PK = barcode so duplicate scans error out.
CREATE TABLE IF NOT EXISTS ic_inventory_barcode (
  barcode      VARCHAR(50)  PRIMARY KEY,
  ic_code      VARCHAR(50)  NOT NULL,
  note         TEXT,
  created_by   VARCHAR(20),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ic_inventory_barcode_code
  ON ic_inventory_barcode (ic_code);
