import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canBeSalesperson, roleFromEmployee } from "@/lib/roles";

type Row = {
  employee_id: number;
  employee_code: string | null;
  fullname_lo: string | null;
  fullname_en: string | null;
  nickname: string | null;
  position_code: string | null;
  access_position_code: string | null;
  app_role: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only employees the admin has explicitly opted into the app via
  // /employees (app_employee_access). Role + position come from that table
  // so an admin can override what odg_employee shows. Anyone not in the
  // table is invisible to the salesperson picker, even if their HR record
  // is ACTIVE — that's the whole point of the access list.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      e.employee_id,
      e.employee_code,
      e.fullname_lo,
      e.fullname_en,
      e.nickname,
      e.position_code,
      a.position_code AS access_position_code,
      a.app_role
    FROM app_employee_access a
    JOIN odg_employee e ON e.employee_code = a.employee_code
    WHERE a.is_active = true
      AND e.employee_code IS NOT NULL
    ORDER BY e.fullname_lo NULLS LAST, e.employee_code
    LIMIT 5000
  `;

  // Picker only shows users who can legitimately be credited for a sale.
  // PC is data-entry only — they create orders on behalf of salespeople,
  // but shouldn't appear as a selectable salesperson themselves.
  const employees = rows
    .map((r) => {
      const positionCode =
        r.access_position_code?.trim() || r.position_code?.trim() || null;
      const appRole = roleFromEmployee({
        appRole: r.app_role,
        positionCode,
      });
      return {
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        fullnameLo: r.fullname_lo,
        fullnameEn: r.fullname_en,
        nickname: r.nickname,
        positionCode,
        appRole,
      };
    })
    .filter((r) => canBeSalesperson(r.appRole));

  return NextResponse.json(employees);
}
