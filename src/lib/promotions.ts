// Promotion validation + serialization helpers. Shared by /api/promotions
// and /api/promotions/[id]; the admin UI consumes the JSON shape produced
// by serializePromotion().
//
// Three promo types are supported at this stage:
//   bogo                — buy triggerQty of triggerItem at the configured
//                         main-item price, get bonusQty of bonusItem free
//   item_pair_price     — buy triggerItem, then bonusItem is priced at bonusPriceKip
//   fixed_price_period  — triggerItem sold at fixedPriceKip during start_at..end_at
//                         (optionally further limited to daily timeFrom..timeTo)
//
// The pricing engine is not yet wired up. These records are CRUD only —
// validation enforces shape so that a future engine can rely on it.

import { Prisma, type AppPromotion } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const PROMO_TYPES = ["bogo", "item_pair_price", "fixed_price_period"] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

export function isPromoType(v: unknown): v is PromoType {
  return typeof v === "string" && (PROMO_TYPES as readonly string[]).includes(v);
}

export type PromoInput = {
  name?: unknown;
  promoType?: unknown;
  isActive?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  timeFrom?: unknown;
  timeTo?: unknown;
  triggerItemCode?: unknown;
  triggerQty?: unknown;
  bonusItemCode?: unknown;
  bonusQty?: unknown;
  bonusPriceKip?: unknown;
  fixedPriceKip?: unknown;
  awardsPoints?: unknown;
  awardsMemberDiscount?: unknown;
  note?: unknown;
};

type CleanInput = {
  name: string;
  promoType: PromoType;
  isActive: boolean;
  startAt: Date | null;
  endAt: Date | null;
  timeFrom: Date | null;
  timeTo: Date | null;
  triggerItemCode: string | null;
  triggerQty: Prisma.Decimal | null;
  bonusItemCode: string | null;
  bonusQty: Prisma.Decimal | null;
  bonusPriceKip: Prisma.Decimal | null;
  fixedPriceKip: Prisma.Decimal | null;
  awardsPoints: boolean;
  awardsMemberDiscount: boolean;
  note: string | null;
};

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function asDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "HH:MM" or "HH:MM:SS" → Date anchored on epoch (Prisma's @db.Time maps to Date).
function asTime(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return null;
  return new Date(`1970-01-01T${t.length === 5 ? `${t}:00` : t}Z`);
}

function asDecimal(v: unknown): Prisma.Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Prisma.Decimal(v);
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    try {
      return new Prisma.Decimal(t);
    } catch {
      return null;
    }
  }
  return null;
}

export function validatePromoInput(
  raw: PromoInput,
): { ok: true; data: CleanInput } | { ok: false; error: string } {
  const name = asTrimmedString(raw.name);
  if (!name) return { ok: false, error: "ກະລຸນາໃສ່ຊື່ໂປຣໂມຊັນ" };

  if (!isPromoType(raw.promoType)) {
    return { ok: false, error: "ປະເພດໂປຣໂມຊັນບໍ່ຖືກຕ້ອງ" };
  }
  const promoType = raw.promoType;
  const isActive = raw.isActive === undefined ? true : Boolean(raw.isActive);
  // Default TRUE so existing API callers (e.g. legacy mobile) that don't
  // pass the flag continue to award points.
  const awardsPoints =
    raw.awardsPoints === undefined ? true : Boolean(raw.awardsPoints);
  const awardsMemberDiscount =
    raw.awardsMemberDiscount === undefined
      ? true
      : Boolean(raw.awardsMemberDiscount);

  const startAt = asDate(raw.startAt);
  const endAt = asDate(raw.endAt);
  if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
    return { ok: false, error: "ວັນທີ່ສິ້ນສຸດຕ້ອງຫຼັງວັນທີ່ເລີ່ມ" };
  }
  const timeFrom = asTime(raw.timeFrom);
  const timeTo = asTime(raw.timeTo);

  const triggerItemCode = asTrimmedString(raw.triggerItemCode);
  const triggerQty = asDecimal(raw.triggerQty);
  const bonusItemCode = asTrimmedString(raw.bonusItemCode);
  const bonusQty = asDecimal(raw.bonusQty);
  const bonusPriceKip = asDecimal(raw.bonusPriceKip);
  const fixedPriceKip = asDecimal(raw.fixedPriceKip);
  const note = asTrimmedString(raw.note);

  // Type-specific shape validation.
  switch (promoType) {
    case "bogo": {
      if (!triggerItemCode || !bonusItemCode) {
        return {
          ok: false,
          error: "BOGO: ກະລຸນາລະບຸລະຫັດສິນຄ້າຕົ້ນ ແລະ ສິນຄ້າແຖມ",
        };
      }
      if (!triggerQty || triggerQty.lte(0)) {
        return { ok: false, error: "BOGO: ຈຳນວນຕົ້ນຕ້ອງມາກກວ່າ 0" };
      }
      if (!bonusQty || bonusQty.lte(0)) {
        return { ok: false, error: "BOGO: ຈຳນວນແຖມຕ້ອງມາກກວ່າ 0" };
      }
      if (!bonusPriceKip || bonusPriceKip.lte(0)) {
        return { ok: false, error: "BOGO: ກະລຸນາໃສ່ລາຄາສິນຄ້າຫຼັກ" };
      }
      break;
    }
    case "item_pair_price": {
      if (!triggerItemCode || !bonusItemCode) {
        return {
          ok: false,
          error: "Item pair: ກະລຸນາລະບຸລະຫັດສິນຄ້າ 2 ລາຍການ",
        };
      }
      if (!bonusPriceKip || bonusPriceKip.lt(0)) {
        return {
          ok: false,
          error: "Item pair: ກະລຸນາໃສ່ລາຄາສິນຄ້າທີ່ 2",
        };
      }
      break;
    }
    case "fixed_price_period": {
      if (!triggerItemCode) {
        return {
          ok: false,
          error: "Fixed price: ກະລຸນາລະບຸລະຫັດສິນຄ້າ",
        };
      }
      if (!fixedPriceKip || fixedPriceKip.lt(0)) {
        return { ok: false, error: "Fixed price: ກະລຸນາໃສ່ລາຄາພິເສດ" };
      }
      if (!startAt || !endAt) {
        return {
          ok: false,
          error: "Fixed price: ກະລຸນາລະບຸວັນທີ່ເລີ່ມ ແລະ ສິ້ນສຸດ",
        };
      }
      break;
    }
  }

  return {
    ok: true,
    data: {
      name,
      promoType,
      isActive,
      startAt,
      endAt,
      timeFrom,
      timeTo,
      triggerItemCode,
      triggerQty,
      bonusItemCode,
      bonusQty,
      bonusPriceKip,
      fixedPriceKip,
      awardsPoints,
      awardsMemberDiscount,
      note,
    },
  };
}

// Auto-close any promotion whose end date has already passed. There's no
// cron in this app, so expiry is enforced lazily: every time an admin loads
// the promotions list (server page or GET API) we sweep promos that are
// still is_active=true but whose end_at is now in the past and flip them off,
// logging an "auto_close" audit row per promo (actor = "system"). A promo
// with no end_at never auto-closes. Returns how many were closed.
export async function autoCloseExpiredPromotions(
  now: Date = new Date(),
): Promise<number> {
  const expired = await prisma.appPromotion.findMany({
    where: {
      isActive: true,
      endAt: { not: null, lt: now },
    },
  });
  if (expired.length === 0) return 0;

  const ids = expired.map((p) => p.id);
  await prisma.appPromotion.updateMany({
    where: { id: { in: ids } },
    data: { isActive: false },
  });

  await prisma.appPromotionAudit
    .createMany({
      data: expired.map((p) => ({
        promotionId: p.id,
        action: "auto_close",
        actorCode: "system",
        snapshot: serializePromotion({
          ...p,
          isActive: false,
        }) as unknown as Prisma.InputJsonValue,
      })),
    })
    .catch((e) => {
      console.warn("[promo-audit] auto_close log failed:", e);
    });

  return expired.length;
}

export function serializePromotion(p: AppPromotion) {
  return {
    id: p.id.toString(),
    name: p.name,
    promoType: p.promoType,
    isActive: p.isActive,
    startAt: p.startAt,
    endAt: p.endAt,
    timeFrom: p.timeFrom ? formatTime(p.timeFrom) : null,
    timeTo: p.timeTo ? formatTime(p.timeTo) : null,
    triggerItemCode: p.triggerItemCode,
    triggerQty: p.triggerQty ? Number(p.triggerQty) : null,
    bonusItemCode: p.bonusItemCode,
    bonusQty: p.bonusQty ? Number(p.bonusQty) : null,
    bonusPriceKip: p.bonusPriceKip ? Number(p.bonusPriceKip) : null,
    fixedPriceKip: p.fixedPriceKip ? Number(p.fixedPriceKip) : null,
    awardsPoints: p.awardsPoints,
    awardsMemberDiscount: p.awardsMemberDiscount,
    note: p.note,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function formatTime(d: Date): string {
  return d.toISOString().slice(11, 16);
}
