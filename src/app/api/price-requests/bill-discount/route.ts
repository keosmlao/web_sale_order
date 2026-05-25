import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { notifyByRole } from "@/lib/notify";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";

// POST /api/price-requests/bill-discount
// Cashier-initiated request for an additional bill-level discount granted
// at receive-money time. Reuses app_price_request with item_code set to the
// BILL_DISCOUNT_ITEM_CODE sentinel so manager approval flows through the
// same UI as per-item price requests.
//
// Body:
//   cartNumber:        '00001'         — the cart being settled
//   originalAmount:    1_000_000       — bill total before extra discount, in LAK
//   discountedAmount:    950_000       — bill total after extra discount, in LAK
//   reason:            string?         — free-text shown to the approver

type Body = {
  cartNumber?: unknown;
  originalAmount?: unknown;
  discountedAmount?: unknown;
  reason?: unknown;
};

export async function POST(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!me.employeeCode) {
    return NextResponse.json(
      { error: "ບໍ່ມີ employeeCode ໃນ token" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const cartNumber =
    typeof body?.cartNumber === "string" ? body.cartNumber.trim() : "";
  const originalAmount = Number(body?.originalAmount);
  const discountedAmount = Number(body?.discountedAmount);
  const reason =
    typeof body?.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim()
      : null;

  if (!cartNumber) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸເລກກະຕ່າ" },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(originalAmount) ||
    !Number.isFinite(discountedAmount) ||
    originalAmount <= 0 ||
    discountedAmount <= 0 ||
    discountedAmount >= originalAmount
  ) {
    return NextResponse.json(
      { error: "ສ່ວນຫຼຸດທ້າຍບິນຕ້ອງໃຫ້ຍອດໃໝ່ > 0 ແລະ ໜ້ອຍກວ່າຍອດເດີມ" },
      { status: 400 },
    );
  }

  // Verify the cart exists and is still pending — a settled cart can't get
  // a fresh bill discount, and pointing at a non-existent cart is a bug.
  // We look up the SOK ic_trans doc by its cart_number suffix.
  const cartRows = await prisma.$queryRaw<
    Array<{ cart_number: string; cust_code: string | null; status: number | null }>
  >`
    SELECT SUBSTRING(doc_no FROM 6) AS cart_number, cust_code, status
    FROM ic_trans
    WHERE doc_format_code = 'SOK'
      AND SUBSTRING(doc_no FROM 6) = ${cartNumber}
    ORDER BY create_date_time_now DESC
    LIMIT 1
  `;
  const cart = cartRows[0];
  if (!cart) {
    return NextResponse.json(
      { error: `ບໍ່ພົບກະຕ່າ ${cartNumber}` },
      { status: 404 },
    );
  }
  if ((cart.status ?? 0) !== 0) {
    return NextResponse.json(
      { error: `ກະຕ່າ ${cartNumber} ບໍ່ໃຊ່ສະຖານະ pending ແລ້ວ` },
      { status: 409 },
    );
  }

  // Disallow stacking: if there's already an open or approved (but un-used)
  // bill-discount request for this cart, force the cashier to cancel/use
  // that one first rather than spawning duplicates.
  const existing = await prisma.appPriceRequest.findFirst({
    where: {
      cartNumber,
      itemCode: BILL_DISCOUNT_ITEM_CODE,
      status: { in: ["pending", "approved"] },
    },
    orderBy: { requestedAt: "desc" },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: `ມີຄຳຂໍສ່ວນຫຼຸດທ້າຍບິນ (${existing.status}) ຢູ່ແລ້ວສຳລັບກະຕ່ານີ້`,
        existingId: existing.id.toString(),
      },
      { status: 409 },
    );
  }

  const created = await prisma.appPriceRequest.create({
    data: {
      cartNumber,
      customerCode: cart.cust_code,
      itemCode: BILL_DISCOUNT_ITEM_CODE,
      originalPrice: new Prisma.Decimal(originalAmount),
      requestedPrice: new Prisma.Decimal(discountedAmount),
      status: "pending",
      requestorCode: me.employeeCode,
      reason,
    },
  });

  // Push to managers. Fire-and-forget — failure to push shouldn't roll
  // back the request; the manager mobile app polls the pending list too.
  notifyByRole("manager", {
    title: "ຄຳຂໍສ່ວນຫຼຸດທ້າຍບິນໃໝ່",
    body: `${me.fullnameLo ?? me.employeeCode} ຂໍຫຼຸດ ${(originalAmount - discountedAmount).toLocaleString("en-US")} ກີບ ໃນກະຕ່າ #${cartNumber}`,
    data: {
      type: "bill_discount_request_new",
      cartNumber,
      requestId: created.id.toString(),
    },
  }).catch((e) => {
    console.warn("[notify] notifyByRole(manager) bill-discount failed:", e);
  });

  return NextResponse.json({
    id: created.id.toString(),
    cartNumber: created.cartNumber,
    originalAmount: Number(created.originalPrice),
    discountedAmount: Number(created.requestedPrice),
    status: created.status,
    requestedAt: created.requestedAt,
  });
}
