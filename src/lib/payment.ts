// Currency + payment constants shared across cashier UI, settle API, and
// price-request approval. Keep these in sync with the SML erp_currency
// rows we depend on.

// '02' is what the rest of the codebase (products, reports, settle) already
// uses for KIP/LAK. '01' is THB, which SML treats as the base currency.
export const MAIN_CURRENCY = "02"; // LAK — what bills are quoted in
export const BASE_CURRENCY = "01"; // THB — SML's internal base

export type CurrencyCode = "01" | "02";
export type PayMethod = "cash" | "transfer";

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
