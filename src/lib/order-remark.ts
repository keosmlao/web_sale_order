// order_cart.remark packs three independent fields the mobile app collects on
// the create-order screen. The format is intentionally human-readable so the
// receipt can show the raw string verbatim:
//
//   "<deliveryName> | ສ່ວນຫຼຸດທ້າຍບິນ: <amount> | ໝາຍເຫດ: <note>"
//
// Any of the parts may be absent. The first unprefixed segment is treated as
// the delivery name (legacy orders only have that). This parser is the
// inverse of the assembly logic in POST /api/orders/route.ts.

export type ParsedRemark = {
  deliveryName: string | null;
  extraDiscount: number;
  note: string | null;
};

const EXTRA_DISCOUNT_PREFIX = "ສ່ວນຫຼຸດທ້າຍບິນ:";
const NOTE_PREFIX = "ໝາຍເຫດ:";

export function parseOrderRemark(raw: string | null | undefined): ParsedRemark {
  const out: ParsedRemark = {
    deliveryName: null,
    extraDiscount: 0,
    note: null,
  };
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return out;

  for (const partRaw of trimmed.split("|")) {
    const part = partRaw.trim();
    if (!part) continue;

    if (part.startsWith(EXTRA_DISCOUNT_PREFIX)) {
      const n = Number(part.slice(EXTRA_DISCOUNT_PREFIX.length).trim());
      if (Number.isFinite(n) && n > 0) out.extraDiscount = n;
    } else if (part.startsWith(NOTE_PREFIX)) {
      const n = part.slice(NOTE_PREFIX.length).trim();
      if (n) out.note = n;
    } else if (out.deliveryName === null) {
      // First unprefixed segment is the delivery name. Subsequent unprefixed
      // segments are ignored (the writer never produces them).
      out.deliveryName = part;
    }
  }

  return out;
}
