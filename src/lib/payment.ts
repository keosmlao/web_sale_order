// Currency + payment constants shared across cashier UI, settle API, and
// price-request approval. Keep these in sync with the SML erp_currency
// rows we depend on.

// '02' is what the rest of the codebase (products, reports, settle) already
// uses for KIP/LAK. '01' is THB, which SML treats as the base currency.
export const MAIN_CURRENCY = "02"; // LAK — what bills are quoted in
export const BASE_CURRENCY = "01"; // THB — SML's internal base

export type CurrencyCode = "01" | "02";

// How a bill gets paid. A bill can carry several of these at once, each for
// part of the total — see the cashier's tender list.
//
//   cash            notes and coins over the counter
//   transfer        the shop's own BCEL QR, scanned by the customer
//   transfer_other  a transfer into some other account the shop holds; the
//                   cashier says which, because that is the whole difference
//                   between this and `transfer`
//   coupon          a coupon redeemed off coupon_list. Not money received —
//                   it reduces what is owed — so it must never post to a
//                   cash or bank account. See payment-accounts.ts.
export type PayMethod = "cash" | "transfer" | "transfer_other" | "coupon";

// Every method, in the order the cashier meets them.
export const PAY_METHODS: readonly PayMethod[] = [
  "cash",
  "transfer",
  "transfer_other",
  "coupon",
] as const;

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: "ເງິນສົດ",
  transfer: "ໂອນ QR",
  transfer_other: "ໂອນບັນຊີອື່ນ",
  coupon: "Coupon",
};

// Only cash may be tendered over the amount owed, because only cash can be
// given back. Change out of a coupon would be turning a discount into money;
// change out of a transfer would be handing back cash the shop never got.
export const CAN_OVERPAY: Record<PayMethod, boolean> = {
  cash: true,
  transfer: false,
  transfer_other: false,
  coupon: false,
};

// Methods that draw on a balance held elsewhere rather than taking a number
// the cashier types. They carry a source and are capped by it.
export const DRAWS_ON_BALANCE: Record<PayMethod, boolean> = {
  cash: false,
  transfer: false,
  transfer_other: false,
  coupon: true,
};

// Currencies the cashier UI lets the customer pay in. Adding a new currency
// is "add code here + add a row to erp_currency"; everything else (multi-
// currency math, payment-line audit) flows from this list.
export const ACCEPTED_CURRENCIES: readonly CurrencyCode[] = ["02", "01"] as const;

// Display labels — keep terse, the UI is space-constrained.
export const CURRENCY_LABEL: Record<CurrencyCode, { name: string; short: string }> = {
  "02": { name: "ກີບ", short: "LAK" },
  "01": { name: "ບາດ", short: "THB" },
};

// Sentinel item_code stored on bill-level discount requests so they reuse
// app_price_request without a real product. The PATCH approval handler
// special-cases this code to skip the order_item update.
export const BILL_DISCOUNT_ITEM_CODE = "__BILL_DISCOUNT__";
