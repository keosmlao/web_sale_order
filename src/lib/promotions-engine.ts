// Promotion application engine. Pure function: given a set of cart lines
// and the active promotion definitions, return the same lines with their
// `promoDiscount` (KIP) and `promoLabel` populated.
//
// Conventions:
//   • fixed_price_period    → reduces unit price to `fixedPriceKip` while the
//                             promo window is open. Implemented as a per-unit
//                             discount equal to (current price − fixed price)
//                             so the original price stays on the SML line.
//   • item_pair_price       → same shape as fixed_price_period, but only
//                             applies when the trigger item is also in cart.
//                             Discount is taken from the bonus line.
//   • bogo                  → reduces the matching trigger qty to the configured
//                             main-item price, then discounts the matching bonus
//                             qty to free. The salesperson must still add the
//                             bonus item to the cart — the engine never injects
//                             new lines here, because SOK insertion needs a
//                             warehouse/location pin that only the cart knows.
//
// The engine never raises a line above its original price; if a stale
// promotion is somehow looser than the customer's standing discount, the
// max(0, …) below keeps the final amount non-negative.

type NumberLike = number | string | { toString(): string } | null;

export type EnginePromotion = {
  id: bigint | number | string;
  name: string;
  promoType: string;
  isActive: boolean;
  startAt: Date | string | null;
  endAt: Date | string | null;
  timeFrom: Date | string | null;
  timeTo: Date | string | null;
  triggerItemCode: string | null;
  triggerQty: NumberLike;
  bonusItemCode: string | null;
  bonusQty: NumberLike;
  bonusPriceKip: NumberLike;
  fixedPriceKip: NumberLike;
  // Per-promo toggles. Each defaults to TRUE if omitted, matching the
  // AppPromotion schema defaults. The two are independent so a promo
  // can earn points without stacking the discount and vice versa.
  awardsPoints?: boolean;          // line earns loyalty points
  awardsMemberDiscount?: boolean;  // member % applies on top of promo price
};

export type EngineLine = {
  productId: string;
  quantity: number;
  price: number;          // unit price KIP (original)
  gross: number;          // price × quantity
  customerDiscount: number;
  promoDiscount: number;
  promoLabel: string;
  amount: number;         // gross − customerDiscount − promoDiscount (≥ 0)
  // Engine sets these to FALSE when a promo opting out touched the
  // line. Downstream code checks each independently — points and the
  // member discount can be denied separately.
  awardsPoints?: boolean;
  awardsMemberDiscount?: boolean;
};

function asDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asNumber(v: NumberLike): number {
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function timeToMinutes(v: Date | string | null): number | null {
  if (typeof v === "string") {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
    if (m) {
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h * 60 + min;
    }
  }
  const d = asDate(v);
  if (!d) return null;
  // Prisma maps @db.Time(6) to Date anchored on epoch in UTC. We treat the
  // wall-clock hh:mm as-is rather than applying the local TZ.
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function isPromoActiveNow(p: EnginePromotion, now: Date): boolean {
  if (!p.isActive) return false;
  const startAt = asDate(p.startAt);
  const endAt = asDate(p.endAt);
  if (startAt && startAt.getTime() > now.getTime()) return false;
  if (endAt && endAt.getTime() < now.getTime()) return false;
  const fromMin = timeToMinutes(p.timeFrom);
  const toMin = timeToMinutes(p.timeTo);
  if (fromMin !== null && toMin !== null) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    // Same-day window only (no overnight wraparound for v1).
    if (fromMin <= toMin) {
      if (nowMin < fromMin || nowMin > toMin) return false;
    } else {
      // Allow overnight (e.g. 22:00–02:00) just in case it's configured.
      if (nowMin < fromMin && nowMin > toMin) return false;
    }
  }
  return true;
}

function pushLabel(line: EngineLine, label: string): void {
  line.promoLabel = line.promoLabel
    ? `${line.promoLabel} + ${label}`
    : label;
}

// Mark the line as opting out of one or both member benefits when the
// touching promo says so. Any single opt-out promo wins — once a line
// is flagged false, no later stacking promo can re-enable it.
function applyStackingFlag(line: EngineLine, promo: EnginePromotion): void {
  if (promo.awardsPoints === false) {
    line.awardsPoints = false;
  }
  if (promo.awardsMemberDiscount === false) {
    line.awardsMemberDiscount = false;
  }
}

export function applyPromotions(
  lines: EngineLine[],
  promos: EnginePromotion[],
  now: Date,
): EngineLine[] {
  const active = promos.filter((p) => isPromoActiveNow(p, now));
  const byCode = new Map<string, EngineLine[]>();
  for (const line of lines) {
    const list = byCode.get(line.productId) ?? [];
    list.push(line);
    byCode.set(line.productId, list);
  }

  // 1. Fixed price for a period (unconditional — only the time window gates it).
  for (const p of active) {
    if (p.promoType !== "fixed_price_period") continue;
    const code = p.triggerItemCode?.trim();
    const fixed = asNumber(p.fixedPriceKip);
    if (!code || fixed < 0) continue;
    const matches = byCode.get(code) ?? [];
    for (const line of matches) {
      // Override the line's price to the promo's fixed price regardless
      // of whether the catalog price is higher or lower. The "discount"
      // can be negative (bundle-style markup) when admin configures a
      // promo price above the catalog — we still force the new price.
      const deltaPerUnit = line.price - fixed;
      line.promoDiscount += deltaPerUnit * line.quantity;
      pushLabel(line, p.name);
      applyStackingFlag(line, p);
    }
  }

  // 2. Item pair: bonus is priced at a fixed value when trigger is in cart.
  for (const p of active) {
    if (p.promoType !== "item_pair_price") continue;
    const triggerCode = p.triggerItemCode?.trim();
    const bonusCode = p.bonusItemCode?.trim();
    const bonusPrice = asNumber(p.bonusPriceKip);
    if (!triggerCode || !bonusCode) continue;
    const triggerLines = byCode.get(triggerCode) ?? [];
    const bonusLines = byCode.get(bonusCode) ?? [];
    if (triggerLines.length === 0 || bonusLines.length === 0) continue;
    const triggerQty = triggerLines.reduce((s, l) => s + l.quantity, 0);
    if (triggerQty <= 0) continue;
    // Eligible bonus qty is bounded by trigger qty so a 1-trigger cart can't
    // discount unlimited bonus units.
    let remaining = triggerQty;
    for (const bonus of bonusLines) {
      if (remaining <= 0) break;
      const eligible = Math.min(remaining, bonus.quantity);
      if (eligible <= 0) continue;
      // Force the bonus to the configured price unconditionally — the
      // delta can be negative when the promo price exceeds the catalog
      // (a bundle deal where the second item gets MORE expensive).
      const deltaPerUnit = bonus.price - bonusPrice;
      bonus.promoDiscount += deltaPerUnit * eligible;
      pushLabel(bonus, p.name);
      applyStackingFlag(bonus, p);
      remaining -= eligible;
    }
  }

  // 3. BOGO: every `triggerQty` units of the trigger is priced at the
  //    configured `bonusPriceKip` (= the promo price for the main item;
  //    0 means the trigger ends up free). The bonus line is always free
  //    (100% off). Admin enters the trigger's promo price in the
  //    "ລາຄາສິນຄ້າທີ່ຕ້ອງຊື້" field — that's bonusPriceKip in the schema.
  for (const p of active) {
    if (p.promoType !== "bogo") continue;
    const triggerCode = p.triggerItemCode?.trim();
    const bonusCode = p.bonusItemCode?.trim();
    const triggerQty = asNumber(p.triggerQty);
    const bonusQty = asNumber(p.bonusQty);
    const triggerPromoPrice = asNumber(p.bonusPriceKip);
    if (
      !triggerCode ||
      !bonusCode ||
      triggerQty <= 0 ||
      bonusQty <= 0 ||
      triggerPromoPrice < 0
    ) {
      continue;
    }
    const triggerLines = byCode.get(triggerCode) ?? [];
    const bonusLines = byCode.get(bonusCode) ?? [];
    if (triggerLines.length === 0 || bonusLines.length === 0) continue;
    const cartTriggerQty = triggerLines.reduce((s, l) => s + l.quantity, 0);
    const sets = Math.floor(cartTriggerQty / triggerQty);
    if (sets <= 0) continue;

    // Trigger: priced at triggerPromoPrice per unit for the matched
    // qty. The delta can be negative when admin set a promo price ABOVE
    // the catalog — that's a "buy this bundle for X" deal where the
    // trigger costs more than its catalog price; the bonus is still
    // free below. Either direction, we force the configured price.
    let triggerBudget = sets * triggerQty;
    for (const trigger of triggerLines) {
      if (triggerBudget <= 0) break;
      const promoOnThisLine = Math.min(triggerBudget, trigger.quantity);
      const deltaPerUnit = trigger.price - triggerPromoPrice;
      trigger.promoDiscount += promoOnThisLine * deltaPerUnit;
      pushLabel(trigger, p.name);
      applyStackingFlag(trigger, p);
      triggerBudget -= promoOnThisLine;
    }

    // Bonus: 100% off.
    let freeBudget = sets * bonusQty;
    for (const bonus of bonusLines) {
      if (freeBudget <= 0) break;
      const freeOnThisLine = Math.min(freeBudget, bonus.quantity);
      bonus.promoDiscount += freeOnThisLine * bonus.price;
      pushLabel(bonus, p.name);
      applyStackingFlag(bonus, p);
      freeBudget -= freeOnThisLine;
    }
  }

  // Recompute the net per line, never below zero (handles weird overlap
  // where promo + customer% would exceed gross).
  for (const line of lines) {
    line.amount = Math.max(
      0,
      line.gross - line.customerDiscount - line.promoDiscount,
    );
  }
  return lines;
}
