-- Stores bank-transfer slip images attached when the cashier records a
-- settlement with transfer_amount > 0. One settlement may have many slips
-- (e.g. customer paid from two accounts → two screenshots).
--
-- doc_no is the cashier doc (ic_trans/cb_trans, e.g. CAKAP26000001).
-- cart_number is also kept so the slip can be looked up from the order_cart
-- side without joining through ic_trans. Neither has a real FK constraint —
-- legacy ic_trans/order_cart rows may be moved/purged outside this app.
--
-- image_data is stored as BYTEA (the API receives base64 from the client and
-- decodes to bytes before INSERT). MIME type is kept so the viewer can serve
-- it back with the right Content-Type header.

CREATE TABLE IF NOT EXISTS app_transfer_slip (
  id            BIGSERIAL    PRIMARY KEY,
  doc_no        VARCHAR(20)  NOT NULL,
  cart_number   VARCHAR(5)   NOT NULL,
  image_data    BYTEA        NOT NULL,
  mime_type     VARCHAR(50)  NOT NULL,
  file_name     VARCHAR(200),
  file_size     INTEGER      NOT NULL,
  uploaded_by   VARCHAR(20),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_transfer_slip_doc_no
  ON app_transfer_slip (doc_no);

CREATE INDEX IF NOT EXISTS idx_app_transfer_slip_cart
  ON app_transfer_slip (cart_number);
