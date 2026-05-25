import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// POST /api/cashier/shift/close
// Closes the calling cashier's open shift after counting cash.
//
// Body: { shiftId: string, countedCash: number, note?: string }
//
// Computes expected_cash = opening_cash + Σ(cash settled this shift)
//                          - Σ(cash refunded via void)
//                          + Σ(cash movements; signed)
// Sets variance = counted_cash - expected_cash. Both stored on the shift
// row so the X/Z report can render the reconciliation breakdown.

type ShiftRow = {
  id: bigint;
  opening_cash: string | number | null;
  status: string;
};

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    shiftId?: unknown;
    countedCash?: unknown;
    note?: unknown;
  } | null;
  const shiftIdStr =
    typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
  const countedCash = Number(body?.countedCash);
  const closingNote =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;
  let shiftId: bigint;
  try {
    shiftId = BigInt(shiftIdStr);
  } catch {
    return NextResponse.json({ error: "shiftId ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!Number.isFinite(countedCash) || countedCash < 0) {
    return NextResponse.json(
      { error: "countedCash ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const shiftRows = await tx.$queryRaw<ShiftRow[]>`
        SELECT id, opening_cash, status FROM app_cashier_shift
        WHERE id = ${shiftId} AND cashier_code = ${employee.employeeCode}
        FOR UPDATE
      `;
      const shift = shiftRows[0];
      if (!shift) {
        throw new Error("ບໍ່ພົບກະຫຼື ບໍ່ແມ່ນກະຂອງເຈົ້າ");
      }
      if (shift.status !== "open") {
        throw new Error("ກະນີ້ປິດແລ້ວ");
      }

      const cashRows = await tx.$queryRaw<
        Array<{ total: string | number | null }>
      >`
        SELECT COALESCE(SUM(cash_kip), 0) AS total
        FROM app_settle_audit
        WHERE shift_id = ${shiftId} AND is_voided = FALSE
      `;
      const voidedCashRows = await tx.$queryRaw<
        Array<{ total: string | number | null }>
      >`
        SELECT COALESCE(SUM(cash_kip), 0) AS total
        FROM app_settle_audit
        WHERE shift_id = ${shiftId} AND is_voided = TRUE
      `;
      const movementRows = await tx.$queryRaw<
        Array<{ total: string | number | null }>
      >`
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM app_cash_movement
        WHERE shift_id = ${shiftId}
      `;
      const opening = Number(shift.opening_cash ?? 0);
      const cashIn = Number(cashRows[0]?.total ?? 0);
      const cashRefunded = Number(voidedCashRows[0]?.total ?? 0);
      const movements = Number(movementRows[0]?.total ?? 0);
      const expectedCash = opening + cashIn - cashRefunded + movements;
      const variance = countedCash - expectedCash;

      await tx.$executeRaw`
        UPDATE app_cashier_shift
        SET status = 'closed',
            closed_at = NOW(),
            closing_cash = ${countedCash},
            expected_cash = ${expectedCash},
            variance = ${variance},
            note = COALESCE(note, '') ||
                   CASE WHEN ${closingNote ?? ""} = '' THEN ''
                        ELSE ${"\nclose: "} || ${closingNote ?? ""}
                   END
        WHERE id = ${shiftId}
      `;
      return { expectedCash, countedCash, variance };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
