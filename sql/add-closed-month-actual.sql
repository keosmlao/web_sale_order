-- Signed-off monthly actuals for closed months (ຍອດຈິງເດືອນທີ່ປິດແລ້ວ).
--
-- odg_sale_detail keeps moving after a month closes: documents get amended,
-- added and reversed long after the books are signed. Measured on 2026-08-11,
-- Jan-Jul 2026 read 612,010,224.56 against the Total Company workbook's
-- 611,963,242.00 — and the drift runs in BOTH directions (Q1 is 78,291 above
-- the sheet while Q2 is 31,155 below it), so it cannot be filtered away.
--
-- When finance needs a closed month to stay on the figure they signed, the
-- approved amount goes in here — one row per month, editable without a deploy.
-- Months with no row keep reading live from odg_sale_detail, which is the
-- right default: the in-progress month must never be frozen.
--
-- IMPORTANT: `amount` is the whole-company total for that month, on the same
-- basis the report uses — every odg_sale_detail line, no branch / argroup /
-- item filter. Do not put a scoped figure in here.

CREATE TABLE IF NOT EXISTS app_closed_month_actual (
  year       smallint NOT NULL,
  month      smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount     numeric(18, 2) NOT NULL,
  note       text,
  updated_by varchar(20),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);

COMMENT ON TABLE app_closed_month_actual IS
  'Finance-approved whole-company monthly actuals. Overrides odg_sale_detail for closed months on the Total Company report.';

-- July 2026 as printed in the workbook (its PreviousMonth_7/2026 row).
-- This replaces a hardcoded 81,573,509.05 that had been carried in the page
-- source: that value was the live July total minus the ENTIRE Jan-Jul drift,
-- so it made the cumulative rows tie out by pushing 47,137 of Q1/Q2 error onto
-- July, leaving PreviousMonth, Q3 and AVG7-9 wrong by that amount instead.
INSERT INTO app_closed_month_actual (year, month, amount, note)
VALUES (2026, 7, 81620646.00, 'Total Company workbook, PreviousMonth_7/2026')
ON CONFLICT (year, month) DO NOTHING;

-- Jan-Jun 2026 are NOT seeded: the workbook was only available at quarter
-- level, and inventing a month split would put fabricated numbers behind a
-- column labelled "approved". Add them as the signed-off monthly figures come
-- to hand — Q1 needs to total 260,447,243 and Q2 269,895,354 to match the
-- sheet, against 260,525,534 and 269,864,199 live today.
