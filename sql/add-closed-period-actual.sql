-- Signed-off actuals for closed periods (ຍອດຈິງທີ່ບັນຊີອະນຸມັດ).
--
-- odg_sale_detail keeps moving after a period closes: documents get amended,
-- added and reversed long after the books are signed. Measured on 2026-08-11,
-- Jan-Jul 2026 read 612,010,224.56 against the Total Company workbook's
-- 611,963,242.00 — and the drift runs in BOTH directions (Q1 is 78,291 above
-- the sheet while Q2 is 31,155 below it), so no filter can reconcile them.
--
-- Finance signs off at whatever granularity they report at, so this table
-- accepts either: a month, or a whole quarter. The Total Company report never
-- shows Jan-Jun individually — every row it draws is a sum over 1-3, 4-6 or
-- 1-7 — so a quarter figure is enough to make the page tie out, and storing it
-- as a quarter keeps us from inventing a month split nobody approved.
--
-- Periods with no row keep reading live from odg_sale_detail, which is the
-- right default: the in-progress period must never be frozen.
--
-- `amount` is the whole-company total on the same basis the report uses —
-- every odg_sale_detail line, no branch / argroup / item filter.

DROP TABLE IF EXISTS app_closed_month_actual;

CREATE TABLE IF NOT EXISTS app_closed_period_actual (
  year        smallint NOT NULL,
  period_type varchar(10) NOT NULL CHECK (period_type IN ('month', 'quarter')),
  period_no   smallint NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  amount      numeric(18, 2) NOT NULL,
  note        text,
  updated_by  varchar(20),
  updated_at  timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (year, period_type, period_no),
  CONSTRAINT quarter_no_in_range
    CHECK (period_type <> 'quarter' OR period_no BETWEEN 1 AND 4)
);

COMMENT ON TABLE app_closed_period_actual IS
  'Finance-approved whole-company actuals. Overrides odg_sale_detail for closed periods on the Total Company report. A month row wins over the quarter containing it.';

-- 2026 as printed in the Total Company workbook: the EST_Q1 / EST_Q2 rows and
-- the PreviousMonth_7/2026 row. July is stored monthly because the sheet
-- prints it monthly; Q1 and Q2 stay quarters because that is all it prints.
--
-- This replaces a hardcoded 81,573,509.05 that had been carried in the page
-- source. That value appeared in no source at all — it was the live July total
-- minus the ENTIRE Jan-Jul drift, so the cumulative rows tied out only by
-- pushing 47,137 of Q1/Q2 error onto July.
INSERT INTO app_closed_period_actual (year, period_type, period_no, amount, note) VALUES
  (2026, 'quarter', 1, 260447243.00, 'Total Company workbook, EST_Q1'),
  (2026, 'quarter', 2, 269895354.00, 'Total Company workbook, EST_Q2'),
  (2026, 'month',   7,  81620646.00, 'Total Company workbook, PreviousMonth_7/2026')
ON CONFLICT (year, period_type, period_no) DO UPDATE
  SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_at = now();
