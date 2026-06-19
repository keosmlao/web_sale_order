-- GL account that each (currency, payment-method) lands in on the cash
-- receipt. cb_trans_detail.trans_number must be the cash/bank account code
-- from gl_chart_of_account (e.g. KIP transfer → '1010201' BCEL LAK current
-- account), NOT the currency code '02'. SML's bank-reconciliation reads this
-- account, so a wrong/missing code breaks reconciliation.
--
-- Editable from /settings/payment-accounts. Settlement reads the active row
-- per (currency_code, pay_method); the DEFAULT_PAYMENT_ACCOUNTS fallback in
-- src/lib/payment-accounts.ts mirrors the seed below.
--
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS app_payment_account (
  currency_code varchar(20)  NOT NULL,          -- '02' LAK, '01' THB
  pay_method    varchar(20)  NOT NULL,          -- 'cash' | 'transfer'
  account_code  varchar(50)  NOT NULL,          -- gl_chart_of_account.code
  note          text,
  updated_by    varchar(20),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (currency_code, pay_method)
);

-- Seed the most-used cash/bank accounts as a starting point. ON CONFLICT
-- DO NOTHING so a manager's later edits in the UI are never overwritten.
INSERT INTO app_payment_account (currency_code, pay_method, account_code, note)
VALUES
  ('02', 'cash',     '1010101', 'ເງິນສົດ-ກີບ (default seed)'),
  ('02', 'transfer', '1010201', 'BCEL LAK current account (default seed)'),
  ('01', 'cash',     '1010102', 'ເງິນສົດ-ບາດ (default seed)'),
  ('01', 'transfer', '1010302', 'BCEL THB current account (default seed)')
ON CONFLICT (currency_code, pay_method) DO NOTHING;
