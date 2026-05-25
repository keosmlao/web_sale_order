-- Per-(currency, method) breakdown of money received at settlement time.
-- One settled order can have multiple rows when the customer paid in mixed
-- currencies (e.g. partial in LAK cash, partial in THB transfer). Sum of
-- amount_in_main across rows MUST equal cb_trans.total_amount_pay converted
-- to the main currency (LAK / code '02').
--
-- The legacy cb_trans table still records aggregate cash_amount/tranfer_amount
-- in THB (SML base) for SML compatibility; app_payment_line is the audit
-- trail showing exactly which currencies+methods made up that aggregate.
--
-- No FK to ic_trans/cb_trans on purpose — SML rows can be migrated/purged
-- outside this app. We keep both doc_no and cart_number so the line can be
-- looked up from either side.

CREATE TABLE IF NOT EXISTS app_payment_line (
  id                     BIGSERIAL    PRIMARY KEY,
  doc_no                 VARCHAR(20)  NOT NULL,
  cart_number            VARCHAR(5)   NOT NULL,
  currency_code          VARCHAR(20)  NOT NULL,        -- '02' LAK, '01' THB, ...
  pay_method             VARCHAR(20)  NOT NULL,        -- 'cash' | 'transfer'
  amount                 NUMERIC(18, 4) NOT NULL,      -- amount in the native currency
  exchange_rate_to_main  NUMERIC(18, 8) NOT NULL,      -- how many LAK = 1 unit of this currency
  amount_in_main         NUMERIC(18, 4) NOT NULL,      -- amount * exchange_rate_to_main
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_payment_line_doc_no
  ON app_payment_line (doc_no);

CREATE INDEX IF NOT EXISTS idx_app_payment_line_cart
  ON app_payment_line (cart_number);
