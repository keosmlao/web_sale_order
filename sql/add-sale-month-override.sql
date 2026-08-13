-- Move a single bill's target/bonus credit to a different month.
--
-- odg_sale_detail is an ETL mirror of the ERP (and a Debezium publication
-- source), so the app must never rewrite a doc_date there: the next load would
-- undo it and the change would leak downstream to every CDC consumer. This
-- table records the intent instead, and the reporting queries read through it.
--
-- Scope on purpose: it moves the month a bill is CREDITED in — targets,
-- achievement, ranking, points, unit rewards, commission. It does not move
-- when the bill physically sold, so the daily "ຂາຍມື້ນີ້" cards, the stock
-- movement report and the YTD brand list keep reading the real doc_date.
--
-- Applied with: node scripts/apply-sql.mjs sql/add-sale-month-override.sql

CREATE TABLE IF NOT EXISTS app_sale_month_override (
  doc_no        varchar(25) PRIMARY KEY,
  -- The date the bill should report under. A date, not a month, so the daily
  -- charts still have a day to sit on.
  report_date   date        NOT NULL,
  -- The doc_date at the time of approval, kept so a later ETL correction that
  -- changes the source date is visible instead of silently double-counting.
  original_date date        NOT NULL,
  reason        text        NOT NULL,
  approved_by   text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_sale_month_override IS
  'Per-bill reporting-month override for retail target and incentive figures. Read by src/lib/sale-month.ts; never written by the ETL.';

-- Every read is "given this doc_no, is it moved?" and the table stays tiny, so
-- the primary key is the whole access path. Indexed the other way too, so the
-- "which bills moved INTO this month" branch of the filter can range-scan.
CREATE INDEX IF NOT EXISTS idx_sale_month_override_report_date
  ON app_sale_month_override (report_date);
