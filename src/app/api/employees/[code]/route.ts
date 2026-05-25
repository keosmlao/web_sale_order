import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  canAssignRoles,
  isValidRole,
  roleFromEmployee,
} from "@/lib/roles";

type RouteContext = {
  params: Promise<{ code: string }>;
};

// PATCH /api/employees/[code]
// Body: { appRole: 'pc' | 'salesperson' | 'head' | 'manager' }
// Updates the per-user role for the sales mobile app. Restricted to head /
// manager — these are the roles that can promote/demote others.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າໃຊ້" }, { status: 401 });
  }
  if (!canAssignRoles(roleFromEmployee(me))) {
    return NextResponse.json(
      { error: "ສະເພາະຫົວໜ້າ ຫຼື ຜູ້ຈັດການ ປ່ຽນສິດໄດ້" },
      { status: 403 },
    );
  }

  const { code } = await context.params;
  const employeeCode = code.trim();
  if (!employeeCode) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸລະຫັດພະນັກງານ" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    appRole?: unknown;
  } | null;
  const raw = body?.appRole;
  // 'auto' (or null) clears the override so the user falls back to whatever
  // position_code → role mapping says. Anything else must be a valid role.
  const clearing = raw === null || raw === "auto";
  if (!clearing && !isValidRole(raw)) {
    return NextResponse.json(
      { error: "appRole ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }

  const existing = await prisma.odgEmployee.findUnique({
    where: { employeeCode },
    select: { employeeId: true },
  });
  if (!existing) {
    return NextResponse.json(
      { error: `ບໍ່ພົບພະນັກງານ: ${employeeCode}` },
      { status: 404 },
    );
  }

  const updated = await prisma.odgEmployee.update({
    where: { employeeCode },
    data: { appRole: clearing ? null : raw },
    select: {
      employeeId: true,
      employeeCode: true,
      fullnameLo: true,
      fullnameEn: true,
      nickname: true,
      positionCode: true,
      appRole: true,
    },
  });

  return NextResponse.json({
    ...updated,
    appRole: roleFromEmployee(updated),
    override: updated.appRole,
  });
}
