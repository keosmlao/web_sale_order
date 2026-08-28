-- Who deleted a settled receipt, and when.
--
-- Deleting a receipt unwinds the cash ledger, the stock movement and the
-- loyalty points, and it removes app_settle_audit along with everything
-- else — so once it is done, nothing in the database says the sale ever
-- happened or that anyone undid it. That is fine for the ledger and wrong
-- for accountability: a cashier may now delete their own same-day receipt
-- without a manager, and the shop should still be able to see who did.
--
-- Written inside the same transaction as the delete, so a row exists here
-- if and only if the delete went through.

CREATE TABLE IF NOT EXISTS app_receipt_delete_log (
  id            BIGSERIAL PRIMARY KEY,
  doc_no        VARCHAR(50)  NOT NULL,   -- the receipt that was deleted
  cart_number   VARCHAR(50),             -- the order it settled
  total_kip     NUMERIC(18, 2),          -- what it was worth, for the record
  settled_by    VARCHAR(50),             -- cashier_code on the receipt
  deleted_by    VARCHAR(50)  NOT NULL,   -- employee who pressed delete
  deleted_role  VARCHAR(30),             -- their role at the time
  deleted_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_receipt_delete_log_doc_no_idx
  ON app_receipt_delete_log (doc_no);
CREATE INDEX IF NOT EXISTS app_receipt_delete_log_deleted_at_idx
  ON app_receipt_delete_log (deleted_at DESC);
