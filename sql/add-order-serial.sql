-- Which serial-tracked unit left the shelf on which order line.
--
-- SML has ic_trans_serial_number for this and it is the eventual home, but
-- it has never been written in this database and the semantics of its
-- trans_flag / calc_flag / last_status columns are not documented here.
-- Guessing them would put rows into the ERP that nobody can vouch for, so
-- the app keeps its own record alongside: additive, reversible, and unable
-- to corrupt anything SML owns. Move it over once someone who knows those
-- flags can confirm the values.
CREATE TABLE IF NOT EXISTS app_order_serial (
  id            bigserial PRIMARY KEY,
  doc_no        varchar(30)  NOT NULL,
  line_number   integer,
  item_code     varchar(30)  NOT NULL,
  serial_number varchar(80),
  isn           varchar(80),
  warehouse_code varchar(20),
  location_code varchar(30),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    varchar(50)
);

CREATE INDEX IF NOT EXISTS app_order_serial_doc_idx
  ON app_order_serial (doc_no);
CREATE INDEX IF NOT EXISTS app_order_serial_serial_idx
  ON app_order_serial (serial_number);
CREATE INDEX IF NOT EXISTS app_order_serial_isn_idx
  ON app_order_serial (isn);
