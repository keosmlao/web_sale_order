import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest, verifyPassword } from "@/lib/auth";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";

// /api/cashier/manager-override — inline register override approval.
//
// The cashier UI lets the cashier give a line discount or bill discount
// up to a configurable threshold without approval. Above that, this
// endpoint records the manager's consent so the discount is auditable
// from the same app_price_request table the standalone approval flow
// uses.
//
// Body:
//   {
//     cartNumber: string,           // SOK cart number (5-6 char doc suffix)
//     overrideType: 'line_discount' | 'bill_discount',
//     itemCode?: string,            // required for line_discount
//     originalPrice: number,        // KIP
//     requestedPrice: number,       // KIP (must be < originalPrice)
//     reason?: string,
//     managerCode: string,          // odg_employee.employee_code of approver
//     managerPin: string,           // pos_pin_hash check OR login password fallback
//   }
//
// Returns the created request id; the settle endpoint (or follow-on UI)
// reads it back from app_price_request when applying the discount.

type EmployeeRow = {
  employee_code: string | null;
  pos_pin_hash: string | null;
  password: string | null;
  app_role: string | null;
  position_code: string | null;
};

export async function POST(request: NextRequest) {
  const cashier = await getEmployeeFromRequest(request);
  if (!cashier) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    cartNumber?: unknown;
    overrideType?: unknown;
    itemCode?: unknown;
    originalPrice?: unknown;
    requestedPrice?: unknown;
    reason?: unknown;
    managerCode?: unknown;
    managerPin?: unknown;
  } | null;

  const cartNumber =
    typeof body?.cartNumber === "string" ? body.cartNumber.trim() : "";
  const overrideType =
    typeof body?.overrideType === "string" ? body.overrideType.trim() : "";
  const itemCode =
    typeof body?.itemCode === "string" ? body.itemCode.trim() : "";
  const originalPrice = Number(body?.originalPrice);
  const requestedPrice = Number(body?.requestedPrice);
  const reason =
    typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;
  const managerCode =
    typeof body?.managerCode === "string" ? body.managerCode.trim() : "";
  const managerPin =
    typeof body?.managerPin === "string" ? body.managerPin : "";

  if (!cartNumber) {
    return NextResponse.json(
      { error: "cartNumber required" },
      { status: 400 },
    );
  }
  if (!["line_discount", "bill_discount"].includes(overrideType)) {
    return NextResponse.json(
      { error: "overrideType ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }
  if (overrideType === "line_discount" && !itemCode) {
    return NextResponse.json(
      { error: "ການລົດລາຄາສິນຄ້າຕ້ອງມີ itemCode" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    return NextResponse.json(
      { error: "originalPrice ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }
  if (
    !Number.isFinite(requestedPrice) ||
    requestedPrice <= 0 ||
    requestedPrice >= originalPrice
  ) {
    return NextResponse.json(
      { error: "ລາຄາໃໝ່ຕ້ອງຕ່ຳກວ່າລາຄາເດີມ" },
      { status: 400 },
    );
  }
  if (!managerCode || !managerPin) {
    return NextResponse.json(
      { error: "ໃສ່ລະຫັດ ແລະ PIN ຂອງຜູ້ຈັດການ" },
      { status: 400 },
    );
  }

  // Verify manager. PIN preferred; fall back to login password if the
  // employee hasn't set a PIN yet (eases rollout — managers can still
  // approve before they've configured one).
  const rows = await prisma.$queryRaw<EmployeeRow[]>`
    SELECT employee_code, pos_pin_hash, password, app_role, position_code
    FROM odg_employee
    WHERE employee_code = ${managerCode}
    LIMIT 1
  `;
  const mgr = rows[0];
  if (!mgr) {
    return NextResponse.json(
      { error: "ບໍ່ພົບລະຫັດຜູ້ຈັດການ" },
      { status: 403 },
    );
  }
  const pinOk = mgr.pos_pin_hash
    ? await verifyPassword(mgr.pos_pin_hash, managerPin)
    : await verifyPassword(mgr.password, managerPin);
  if (!pinOk) {
    return NextResponse.json(
      { error: "PIN ບໍ່ຖືກຕ້ອງ" },
      { status: 403 },
    );
  }
  const role = roleFromEmployee({
    appRole: mgr.app_role,
    positionCode: mgr.position_code,
  });
  if (!canApprovePriceRequests(role)) {
    return NextResponse.json(
      { error: "ບໍ່ໃຫ້ສິດອະນຸມັດສ່ວນຫຼຸດ — ຕ້ອງເປັນ Manager" },
      { status: 403 },
    );
  }

  // Persist as an approved app_price_request so the settle endpoint
  // (and the receipt history search) sees it through the existing
  // price-request join. bill_discount uses the sentinel item code so the
  // settle code already knows how to consume it; line_discount uses the
  // real item code.
  const targetItem =
    overrideType === "bill_discount" ? BILL_DISCOUNT_ITEM_CODE : itemCode;
  const inserted = await prisma.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO app_price_request (
      cart_number, customer_code, item_code,
      original_price, requested_price,
      status, requestor_code, approver_code,
      approver_note, reason,
      requested_at, decided_at,
      override_type
    )
    VALUES (
      ${cartNumber}, NULL, ${targetItem},
      ${originalPrice}, ${requestedPrice},
      'approved', ${cashier.employeeCode ?? ""}, ${managerCode},
      ${reason}, ${reason},
      NOW(), NOW(),
      ${overrideType}
    )
    RETURNING id
  `;

  return NextResponse.json({
    ok: true,
    requestId: inserted[0]?.id.toString(),
    overrideType,
  });
}
