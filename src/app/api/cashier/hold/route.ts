import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/cashier/hold — park/resume an SOK at the counter without losing
// the cart. Held bills stay status=0 in ic_trans; the sidecar row in
// app_held_cart is what flags them as "parked" so the cashier list can
// filter them out of the default Incoming view.
//
//   POST   { cartNumber, reason? }  → park
//   DELETE { cartNumber }           → resume (remove the hold flag)

type SokRow = {
  doc_no: string | null;
  status: number | null;
};

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    cartNumber?: unknown;
    reason?: unknown;
  } | null;
  const cartNumber =
    typeof body?.cartNumber === "string" ? body.cartNumber.trim() : "";
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;
  if (!cartNumber) {
    return NextResponse.json(
      { error: "cartNumber required" },
      { status: 400 },
    );
  }

  const sokRows = await prisma.$queryRaw<SokRow[]>`
    SELECT doc_no, status FROM ic_trans
    WHERE doc_format_code = 'SOK'
      AND SUBSTRING(doc_no FROM 6) = ${cartNumber}
    ORDER BY create_date_time_now DESC
    LIMIT 1
  `;
  const sok = sokRows[0];
  if (!sok || !sok.doc_no) {
    return NextResponse.json(
      { error: `ບໍ່ພົບກະຕ່າ ${cartNumber}` },
      { status: 404 },
    );
  }
  if ((sok.status ?? 0) !== 0) {
    return NextResponse.json(
      { error: `ກະຕ່າ ${cartNumber} ຮັບເງິນແລ້ວ ພັກບໍ່ໄດ້` },
      { status: 409 },
    );
  }

  await prisma.$executeRaw`
    INSERT INTO app_held_cart (cart_number, doc_no, held_by, reason)
    VALUES (${cartNumber}, ${sok.doc_no}, ${employee.employeeCode ?? ""}, ${reason})
    ON CONFLICT (cart_number) DO UPDATE
      SET held_by = EXCLUDED.held_by,
          reason  = EXCLUDED.reason,
          held_at = NOW()
  `;

  return NextResponse.json({ ok: true, cartNumber });
}

export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const cartNumber = url.searchParams.get("cartNumber")?.trim() ?? "";
  if (!cartNumber) {
    return NextResponse.json(
      { error: "cartNumber required" },
      { status: 400 },
    );
  }
  await prisma.$executeRaw`
    DELETE FROM app_held_cart WHERE cart_number = ${cartNumber}
  `;
  return NextResponse.json({ ok: true, cartNumber });
}
