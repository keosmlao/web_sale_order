import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// GET /api/price-requests/approved-for?customerCode=X&itemCode=Y
//
// Returns the latest APPROVED standalone price request for the given
// (customer, item) pair — used by the create-order flow to auto-apply
// pre-approved special prices when the salesperson adds that item to cart.
//
// Cart-bound (legacy) approved requests are intentionally excluded: those
// belong to the cart that requested them and were already factored into
// that cart's amount.
export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const customerCode = request.nextUrl.searchParams
    .get("customerCode")
    ?.trim();
  const itemCode = request.nextUrl.searchParams.get("itemCode")?.trim();
  if (!customerCode || !itemCode) {
    return NextResponse.json(
      { error: "customerCode + itemCode ຕ້ອງມີ" },
      { status: 400 },
    );
  }
  // Only surface approved rows that actually carry a price set by the
  // approver — requestedPrice became nullable when price entry moved from
  // requestor to approver, so a legacy/half-decided row could be null.
  const row = await prisma.appPriceRequest.findFirst({
    where: {
      customerCode,
      itemCode,
      status: "approved",
      cartNumber: null,
      requestedPrice: { not: null },
    },
    orderBy: { decidedAt: "desc" },
  });
  if (!row || row.requestedPrice === null) {
    return NextResponse.json({ approved: null });
  }
  return NextResponse.json({
    approved: {
      id: row.id.toString(),
      originalPrice: Number(row.originalPrice),
      requestedPrice: Number(row.requestedPrice),
      reason: row.reason,
      decidedAt: row.decidedAt,
      approverCode: row.approverCode,
    },
  });
}
