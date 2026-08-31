// The customer code stamped on a bill when nobody was attached to the cart.
//
// A blank cust_code looks harmless — SML's columns are VARCHAR and the
// inserts all coalesce to '' — but every back-office figure this app reports
// on is keyed off the customer: `saleBasis()` filters `argroup_main = '101'`,
// which comes from joining ar_customer / ar_customer_detail. A bill with a
// blank code joins to nothing, so it silently drops out of ຍອດຂາຍ, ranking,
// achievement and bonus.
//
// SML's own counter never leaves it blank: all 3,415 CAK bills raised since
// June 2026 carry a real code, and the storefront's walk-in sales use
// '01-2125' — "ລູກຄ້າໜ້າຮ້ານ(ຂົວຫຼວງ)", which sits in group_main 101. We
// follow that.
//
// Note this is the code written onto the *documents* (ic_trans,
// ic_trans_detail, cb_trans, ic_trans_shipment). It is deliberately NOT the
// code the loyalty logic sees — a walk-in has no member account, so points
// are never earned or redeemed against the shared walk-in customer.
export const DEFAULT_WALKIN_CUSTOMER_CODE = "01-2125";

export function walkInCustomerCode(): string {
  const raw = process.env.WALKIN_CUSTOMER_CODE?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_WALKIN_CUSTOMER_CODE;
}
