import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/cashier/shift/current
// Returns the current open shift for the calling cashier (or null).

type ShiftRow = {
  id: bigint;
  cashier_code: string;
  branch_code: string | null;
  opened_at: Date;
  opening_cash: string | number | null;
  status: string;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await prisma.$queryRaw<ShiftRow[]>`
    SELECT id, cashier_code, branch_code, opened_at, opening_cash, status
    FROM app_cashier_shift
    WHERE cashier_code = ${employee.employeeCode} AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ shift: null });
  }
  return NextResponse.json({
    shift: {
      id: row.id.toString(),
      cashierCode: row.cashier_code,
      branchCode: row.branch_code,
      openedAt: row.opened_at.toISOString(),
      openingCash: row.opening_cash ? Number(row.opening_cash) : 0,
      status: row.status,
    },
  });
}
