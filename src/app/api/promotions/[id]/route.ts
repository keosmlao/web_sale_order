import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canManagePromotions, roleFromEmployee } from "@/lib/roles";
import {
  serializePromotion,
  validatePromoInput,
  type PromoInput,
} from "@/lib/promotions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseId(raw: string): bigint | null {
  try {
    return BigInt(raw.trim());
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: raw } = await context.params;
  const id = parseId(raw);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const promo = await prisma.appPromotion.findUnique({ where: { id } });
  if (!promo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serializePromotion(promo));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManagePromotions(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ແກ້ໄຂ ໂປຣໂມຊັນ ໄດ້" },
      { status: 403 },
    );
  }
  const { id: raw } = await context.params;
  const id = parseId(raw);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const existing = await prisma.appPromotion.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as PromoInput | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validatePromoInput({
    // PATCH still re-validates the full record — merge incoming fields onto
    // the existing row so callers can send partial updates safely.
    name: body.name ?? existing.name,
    promoType: body.promoType ?? existing.promoType,
    isActive: body.isActive ?? existing.isActive,
    startAt: body.startAt ?? existing.startAt,
    endAt: body.endAt ?? existing.endAt,
    timeFrom: body.timeFrom ?? existing.timeFrom,
    timeTo: body.timeTo ?? existing.timeTo,
    triggerItemCode: body.triggerItemCode ?? existing.triggerItemCode,
    triggerQty:
      body.triggerQty ??
      (existing.triggerQty ? existing.triggerQty.toString() : null),
    bonusItemCode: body.bonusItemCode ?? existing.bonusItemCode,
    bonusQty:
      body.bonusQty ??
      (existing.bonusQty ? existing.bonusQty.toString() : null),
    bonusPriceKip:
      body.bonusPriceKip ??
      (existing.bonusPriceKip ? existing.bonusPriceKip.toString() : null),
    fixedPriceKip:
      body.fixedPriceKip ??
      (existing.fixedPriceKip ? existing.fixedPriceKip.toString() : null),
    awardsPoints: body.awardsPoints ?? existing.awardsPoints,
    awardsMemberDiscount:
      body.awardsMemberDiscount ?? existing.awardsMemberDiscount,
    note: body.note ?? existing.note,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const updated = await prisma.appPromotion.update({
    where: { id },
    data: validation.data,
  });
  // Audit: capture the post-update snapshot. Pre-update snapshot lives
  // in the previous audit row (or absent if this is the first edit).
  await prisma.appPromotionAudit
    .create({
      data: {
        promotionId: id,
        action: "update",
        actorCode: employee.employeeCode ?? "",
        snapshot: serializePromotion(updated) as unknown as object,
      },
    })
    .catch((e) => {
      console.warn("[promo-audit] update log failed:", e);
    });
  return NextResponse.json(serializePromotion(updated));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManagePromotions(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ລົບ ໂປຣໂມຊັນ ໄດ້" },
      { status: 403 },
    );
  }
  const { id: raw } = await context.params;
  const id = parseId(raw);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  // Snapshot before deleting so the audit row preserves the final state.
  const existing = await prisma.appPromotion.findUnique({ where: { id } });
  await prisma.appPromotion.delete({ where: { id } }).catch(() => null);
  if (existing) {
    await prisma.appPromotionAudit
      .create({
        data: {
          promotionId: id,
          action: "delete",
          actorCode: employee.employeeCode ?? "",
          snapshot: serializePromotion(existing) as unknown as object,
        },
      })
      .catch((e) => {
        console.warn("[promo-audit] delete log failed:", e);
      });
  }
  return NextResponse.json({ ok: true });
}
