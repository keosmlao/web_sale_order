import { prisma } from "@/lib/prisma";
import type { CurrencyCode, PayMethod } from "@/lib/payment";

// Maps each (currency, method) to the gl_chart_of_account.code that the cash
// receipt posts to (cb_trans_detail.trans_number). Server-only — keep prisma
// out of payment.ts, which the cashier client bundle imports.

export type PaymentAccountKey = `${CurrencyCode}:${PayMethod}`;

const key = (currency: string, method: string): PaymentAccountKey =>
  `${currency}:${method}` as PaymentAccountKey;

// Bootstrap fallback, mirrored by the seed in sql/add-payment-account.sql.
// Used only when app_payment_account has no row for a (currency, method) yet
// (or the table is missing on an un-migrated DB).
export const DEFAULT_PAYMENT_ACCOUNTS: Partial<
  Record<PaymentAccountKey, string>
> = {
  "02:cash": "1010101",     // ເງິນສົດ-ກີບ
  "02:transfer": "1010201", // BCEL LAK current account
  "01:cash": "1010102",     // ເງິນສົດ-ບາດ
  "01:transfer": "1010302", // BCEL THB current account
  // A transfer into another of the shop's accounts posts wherever the
  // cashier says it landed; the line carries its own account code and only
  // falls back here if it somehow arrives without one.
  "02:transfer_other": "1010201",
  "01:transfer_other": "1010302",
  // Deliberately absent: coupon.
  //
  // Redeeming a coupon is not money arriving. Posting it to cash or to a
  // bank account would overstate both, and the till would not reconcile at
  // the end of the day. It belongs against whatever account ODIEN books
  // promotional giveaways to, and guessing which one is worse than not
  // taking coupons yet — so settle refuses a coupon line until a manager
  // sets the account in /settings/payment-accounts.
};

type AccountRow = {
  currency_code: string | null;
  pay_method: string | null;
  account_code: string | null;
};

// (currency, method) → account_code, falling back to DEFAULT_PAYMENT_ACCOUNTS
// for any pair the table doesn't cover.
export async function getPaymentAccountMap(): Promise<
  Record<PaymentAccountKey, string>
> {
  const map: Record<string, string> = {
    ...(DEFAULT_PAYMENT_ACCOUNTS as Record<string, string>),
  };
  try {
    const rows = await prisma.$queryRaw<AccountRow[]>`
      SELECT currency_code, pay_method, account_code
      FROM app_payment_account
    `;
    for (const r of rows) {
      const c = r.currency_code?.trim();
      const m = r.pay_method?.trim();
      const a = r.account_code?.trim();
      if (c && m && a) map[key(c, m)] = a;
    }
  } catch {
    // table not migrated yet — defaults are correct enough to settle.
  }
  return map as Record<PaymentAccountKey, string>;
}

// Resolve a single account, defaulting if unconfigured.
export function resolvePaymentAccount(
  map: Record<PaymentAccountKey, string>,
  currency: CurrencyCode,
  method: PayMethod,
): string | null {
  return (
    map[key(currency, method)] ??
    DEFAULT_PAYMENT_ACCOUNTS[key(currency, method)] ??
    null
  );
}

export type SelectableAccount = {
  code: string;
  name: string;
};

// Cash + bank leaf accounts (account_level 6) that a manager can pick from in
// the settings UI: 10101x cash, 10102x KIP bank, 10103x THB bank, 10104x USD
// bank. Active only.
export async function getSelectableAccounts(): Promise<SelectableAccount[]> {
  const rows = await prisma.$queryRaw<
    Array<{ code: string | null; name_1: string | null }>
  >`
    SELECT code, name_1
    FROM gl_chart_of_account
    WHERE account_level = 6
      AND active_status = 1
      AND (
        code LIKE '10101%' OR code LIKE '10102%'
        OR code LIKE '10103%' OR code LIKE '10104%'
      )
    ORDER BY code
  `;
  return rows
    .filter((r): r is { code: string; name_1: string | null } => !!r.code)
    .map((r) => ({ code: r.code, name: r.name_1?.trim() || r.code }));
}
