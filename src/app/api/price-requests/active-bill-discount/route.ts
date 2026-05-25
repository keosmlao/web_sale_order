import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";

// GET /api/price-requests/active-bill-discount?cartNumber=00001
//
// Returns the latest bill-discount request (pending OR approved OR rejected)
// for a cart so the cashier UI can poll without paging through every legacy
// per-item request. Rejected/used requests are still returned so the cashier
// sees the reason; the UI decides what to do with each status.

export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cartNumber = request.nextUrl.searchParams.get("cartNumber")?.trim();
  if (!cartNumber) {
    return NextResponse.json(
      { error: "cartNumber ຕ້ອງມີ" },
      { status: 400 },
    );
  }

  const row = await prisma.appPriceRequest.findFirst({
    where: {
      cartNumber,
      itemCode: BILL_DISCOUNT_ITEM_CODE,
    },
    orderBy: { requestedAt: "desc" },
  });
  if (!row) return NextResponse.json({ request: null });

  return NextResponse.json({
    request: {
      id: row.id.toString(),
      originalAmount: Number(row.originalPrice),
      discountedAmount: Number(row.requestedPrice),
      status: row.status,
      reason: row.reason,
      requestorCode: row.requestorCode,
      approverCode: row.approverCode,
      approverNote: row.approverNote,
      requestedAt: row.requestedAt,
      decidedAt: row.decidedAt,
    },
  });
}
