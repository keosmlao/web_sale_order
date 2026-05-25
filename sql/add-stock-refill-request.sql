-- Stock-refill workflow: when a warehouse's current stock drops at/below
-- target, the floor staff opens a "ຂໍເຕີມສະຕ້ອກ" request. A manager/head
-- approves it, and someone (warehouse/transfer team) marks it fulfilled
-- once the stock actually arrives in the warehouse.
--
-- Status lifecycle: pending -> approved -> fulfilled
--                                       \-> cancelled (by requestor before approve)
--                          \-> rejected
--
-- Snapshot columns freeze the stock/min/target at request time so the audit
-- view stays meaningful even after the live values move.

CREATE TABLE IF NOT EXISTS app_stock_refill_request (
  id               BIGSERIAL PRIMARY KEY,
  warehouse_code   VARCHAR(20)   NOT NULL,
  item_code        VARCHAR(50)   NOT NULL,
  requested_qty    NUMERIC(18,2) NOT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'pending',
                                 -- 'pending' | 'approved' | 'rejected'
                                 -- | 'fulfilled' | 'cancelled'
  requestor_code   VARCHAR(20)   NOT NULL,
  approver_code    VARCHAR(20),
  fulfiller_code   VARCHAR(20),
  reason           TEXT,
  approver_note    TEXT,
  ref_doc_no       VARCHAR(50),
  snapshot_stock   NUMERIC(18,2),
  snapshot_min     NUMERIC(18,2),
  snapshot_target  NUMERIC(18,2),
  requested_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  decided_at       TIMESTAMPTZ,
  fulfilled_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_stock_refill_request_status
  ON app_stock_refill_request (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_stock_refill_request_warehouse_item
  ON app_stock_refill_request (warehouse_code, item_code, status);
