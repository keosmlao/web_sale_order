// The member discount.
//
// Every customer the POS can pick is a member — the customer list filters
// on ar_customer.reg_group = 'member', and the order route refuses anyone
// else — and membership is worth 3% at the counter.
//
// It has to default here rather than in the ERP. The rate lives in
// ar_customer_detail.discount_item, and that field is blank for 17,633 of
// the 17,640 members on file: only seven were ever filled in by hand. So
// members were being charged full price, and every member registered from
// now on would be too.
//
// A blank field means "nobody set this", not "no discount" — those need
// different answers. A field that parses to a number is somebody's
// decision and is honoured as written, including a deliberate 0 and
// including a negotiated rate above 3.
//
// Walk-in customers get nothing; that is decided by the caller, before
// this is reached.
export const MEMBER_DEFAULT_DISCOUNT_PCT = 3;

export function memberDiscountPct(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return MEMBER_DEFAULT_DISCOUNT_PCT;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "").trim();
  if (cleaned === "") return MEMBER_DEFAULT_DISCOUNT_PCT;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return MEMBER_DEFAULT_DISCOUNT_PCT;
  // A rate that would pay the customer, or hand them the goods, is a data
  // error rather than an instruction.
  if (n < 0 || n > 100) return MEMBER_DEFAULT_DISCOUNT_PCT;
  return n;
}
