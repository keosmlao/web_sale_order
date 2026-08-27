import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  cartTotals,
  priceCart,
  type EngineLine,
  type PromoSelections,
} from "@/lib/promotions-engine";

// Price a cart against the live promotions.
//
// This exists so there is exactly one promotion engine. The POS page and
// the order/settle routes already share src/lib/promotions-engine.ts by
// importing it; the Flutter app could not, so it carried a hand-ported
// Dart copy that had to be kept in step by hand — and a cart priced one
// way on the tablet and another way on the server is a wrong bill. The
// app calls this instead.
//
// Preview only. /api/orders re-prices from scratch at submit, so a stale
// or failed response here costs the cashier an out-of-date number on
// screen, never a wrong charge.

type LineInput = {
  productId?: unknown;
  quantity?: unknown;
  price?: unknown;
  customerDiscount?: unknown;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { lines?: unknown; selections?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawLines = Array.isArray(body.lines) ? (body.lines as LineInput[]) : [];
  const lines: EngineLine[] = rawLines
    .map((l) => {
      const productId = String(l.productId ?? "").trim();
      const quantity = Math.trunc(num(l.quantity));
      const price = num(l.price);
      const customerDiscount = num(l.customerDiscount);
      const gross = price * quantity;
      return {
        productId,
        quantity,
        price,
        gross,
        customerDiscount,
        promoDiscount: 0,
        promoLabel: "",
        amount: Math.max(0, gross - customerDiscount),
      };
    })
    .filter((l) => l.productId !== "" && l.quantity > 0);

  if (lines.length === 0) {
    return NextResponse.json({
      lines: [],
      totals: { gross: 0, customerDiscount: 0, promoDiscount: 0, net: 0 },
    });
  }

  // Selections are keyed by trigger item code; values are promotion ids
  // (or null when the cashier declined every promo on that trigger).
  const selections: PromoSelections = {};
  if (body.selections && typeof body.selections === "object") {
    for (const [code, value] of Object.entries(
      body.selections as Record<string, unknown>,
    )) {
      const key = code.trim();
      if (!key) continue;
      selections[key] = value == null ? null : String(value);
    }
  }

  // Same source as /api/orders: every enabled promo, with the date and
  // time-of-day windows left to the engine so both agree on "active".
  const promos = await prisma.appPromotion.findMany({
    where: { isActive: true },
  });

  const priced = priceCart(lines, promos, selections, new Date());

  return NextResponse.json({
    lines: priced.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      price: l.price,
      gross: l.gross,
      customerDiscount: l.customerDiscount,
      promoDiscount: l.promoDiscount,
      promoLabel: l.promoLabel,
      amount: l.amount,
      awardsPoints: l.awardsPoints !== false,
      awardsMemberDiscount: l.awardsMemberDiscount !== false,
    })),
    totals: cartTotals(priced),
  });
}
