import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { serializePromotion } from "@/lib/promotions";
import { isPromoActiveNow } from "@/lib/promotions-engine";

// Returns the promotions that are live *right now* — enabled, inside their
// start/end window, and inside their daily time-of-day window.
//
// The time-of-day gate is applied here in JS rather than in SQL: the stored
// TIME is Lao shop hours while the server clock is UTC, so a Postgres
// comparison would be seven hours out. isPromoActiveNow() is the engine's
// own gate, which keeps this list consistent with what /api/promotions/price
// and /api/orders will actually charge.
//
// Clients use this for UI hints — badges, the promo chooser, the
// "ໂປຣ ABC" line labels — and never as the source of truth for money.
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

  return NextResponse.json(
    rows.filter((p) => isPromoActiveNow(p, now)).map(serializePromotion),
  );
}
