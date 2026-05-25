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

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl;
  const typeFilter = url.searchParams.get("type")?.trim() || null;
  const activeOnly = url.searchParams.get("active") === "1";

  const rows = await prisma.appPromotion.findMany({
    where: {
      ...(typeFilter ? { promoType: typeFilter } : {}),
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });

  return NextResponse.json(rows.map(serializePromotion));
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManagePromotions(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ສ້າງ ໂປຣໂມຊັນ ໄດ້" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as PromoInput | null;
  if (!body) {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const validation = validatePromoInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const created = await prisma.appPromotion.create({
    data: {
      ...validation.data,
      createdBy: employee.employeeCode ?? null,
    },
  });
  await prisma.appPromotionAudit
    .create({
      data: {
        promotionId: created.id,
        action: "create",
        actorCode: employee.employeeCode ?? "",
        snapshot: serializePromotion(created) as unknown as object,
      },
    })
    .catch((e) => {
      console.warn("[promo-audit] create log failed:", e);
    });

  return NextResponse.json(serializePromotion(created), { status: 201 });
}
