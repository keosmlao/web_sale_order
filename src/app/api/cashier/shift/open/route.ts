import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// POST /api/cashier/shift/open
// Opens a new cashier shift. Body: { openingCash: number, note?: string }
// Rejects if the cashier already has an open shift.

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    openingCash?: unknown;
    note?: unknown;
    branchCode?: unknown;
  } | null;
  const openingCash = Number(body?.openingCash);
  const note =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;
  const branchCode =
    typeof body?.branchCode === "string" && body.branchCode.trim()
      ? body.branchCode.trim()
      : null;
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return NextResponse.json(
      { error: "openingCash ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }

  const existing = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM app_cashier_shift
    WHERE cashier_code = ${employee.employeeCode} AND status = 'open'
    LIMIT 1
  `;
  if (existing[0]) {
    return NextResponse.json(
      { error: "ມີກະທີ່ເປີດຢູ່ແລ້ວ ກະລຸນາປິດກ່ອນ" },
      { status: 409 },
    );
  }

  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO app_cashier_shift (
      cashier_code, branch_code, opening_cash, note, status
    )
    VALUES (
      ${employee.employeeCode}, ${branchCode}, ${openingCash}, ${note}, 'open'
    )
    RETURNING id
  `;
  return NextResponse.json({ ok: true, shiftId: rows[0]?.id.toString() });
}
