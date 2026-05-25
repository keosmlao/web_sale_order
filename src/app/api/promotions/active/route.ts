import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { serializePromotion } from "@/lib/promotions";

// Returns the promotions that are active *right now*: is_active=true AND
// the current time falls inside the configured start/end window. The
// time-of-day window (time_from / time_to) is not checked here because
// Postgres TIME comparison cleanly handles only same-TZ semantics — the
// authoritative gate lives in the order-create endpoint via
// applyPromotions(). Clients use this list for UI hints (badges /
// "ໂປຣ ABC" labels on cart lines) and never as the source of truth.
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const rows = await prisma.appPromotion.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startAt: null }, { startAt: { lte: now } }] },
        { OR: [{ endAt: null }, { endAt: { gte: now } }] },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json(rows.map(serializePromotion));
}
