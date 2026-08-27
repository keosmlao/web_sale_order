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

  // The roster is odg_employee; app_employee_access is an override on top
  // of it, not the gate into it. Driving this off the access table meant
  // the four rows in it were the only salespeople the app could name — so
  // every cart line credited to anyone else showed a bare employee code,
  // and the "change salesperson" picker offered four people out of 193.
  // Access still decides what someone may DO (see roles.ts); it does not
  // decide whether they exist.
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
    FROM odg_employee e
    LEFT JOIN app_employee_access a
      ON a.employee_code = e.employee_code AND a.is_active = true
    WHERE e.employee_code IS NOT NULL
      AND COALESCE(e.fullname_lo, e.fullname_en, '') <> ''
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
