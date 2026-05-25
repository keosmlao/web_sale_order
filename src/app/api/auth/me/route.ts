import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    employeeId: employee.employeeId,
    employeeCode: employee.employeeCode,
    fullnameLo: employee.fullnameLo,
    fullnameEn: employee.fullnameEn,
    nickname: employee.nickname,
    positionCode: employee.positionCode,
    appRole: roleFromEmployee(employee),
  });
}
