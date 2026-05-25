import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// POST /api/cashier/shift/movement
// Records a cash drop / payout / adjustment inside an open shift.
// Body: { shiftId, type: 'drop'|'payout'|'adjustment', amount: number, reason }
//
// Sign convention:
//   drop       → amount is positive in body, stored NEGATIVE (cash leaves drawer)
//   payout     → amount positive in body, stored NEGATIVE (cash leaves drawer)
//   adjustment → caller passes signed amount (positive or negative)

type ShiftRow = {
  id: bigint;
  cashier_code: string;
  status: string;
};

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    shiftId?: unknown;
    type?: unknown;
    amount?: unknown;
    reason?: unknown;
  } | null;
  const shiftIdStr =
    typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const amountIn = Number(body?.amount);
  const reason =
    typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  let shiftId: bigint;
  try {
    shiftId = BigInt(shiftIdStr);
  } catch {
    return NextResponse.json({ error: "shiftId ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!["drop", "payout", "adjustment"].includes(type)) {
    return NextResponse.json(
      { error: "type ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(amountIn) || amountIn === 0) {
    return NextResponse.json(
      { error: "amount ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "ກະລຸນາໃສ່ເຫດຜົນ" },
      { status: 400 },
    );
  }
  // Drop/payout are always cash-out — flip sign if the caller submitted
  // a positive number. Adjustment keeps the caller's sign verbatim.
  const amount =
    type === "drop" || type === "payout"
      ? -Math.abs(amountIn)
      : amountIn;

  const rows = await prisma.$queryRaw<ShiftRow[]>`
    SELECT id, cashier_code, status FROM app_cashier_shift
    WHERE id = ${shiftId}
    LIMIT 1
  `;
  const shift = rows[0];
  if (!shift) {
    return NextResponse.json({ error: "ບໍ່ພົບກະ" }, { status: 404 });
  }
  if (shift.cashier_code !== employee.employeeCode) {
    return NextResponse.json(
      { error: "ບໍ່ແມ່ນກະຂອງເຈົ້າ" },
      { status: 403 },
    );
  }
  if (shift.status !== "open") {
    return NextResponse.json({ error: "ກະປິດແລ້ວ" }, { status: 409 });
  }

  await prisma.$executeRaw`
    INSERT INTO app_cash_movement (
      shift_id, movement_type, amount, reason, actor_code
    )
    VALUES (
      ${shiftId}, ${type}, ${amount}, ${reason}, ${employee.employeeCode}
    )
  `;
  return NextResponse.json({ ok: true });
}
