import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee, isValidRole } from "@/lib/roles";
import { getHiddenMenuMap } from "@/lib/menu-visibility";
import { MENU_REGISTRY_KEYS } from "@/lib/menu-registry";

function isManager(employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) {
  return !!employee && roleFromEmployee(employee) === "manager";
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    canManage: isManager(employee),
    hidden: await getHiddenMenuMap(),
  });
}

// Replace the entire hidden-menu set. Body: { hidden: { [role]: string[] } }.
// Mirrors the sales-warehouse "set" semantics: wipe, then insert the rows the
// admin wants hidden — inside a transaction so it is atomic.
export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isManager(employee)) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ຕັ້ງຄ່າການສະແດງເມນູໄດ້" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { hidden?: Record<string, unknown> }
    | null;
  const hiddenInput = body?.hidden ?? {};

  // Normalise to validated (menu_key, role) pairs — only known roles and
  // known menu keys survive.
  const pairs: { key: string; role: string }[] = [];
  for (const [role, keys] of Object.entries(hiddenInput)) {
    if (!isValidRole(role)) continue;
    if (!Array.isArray(keys)) continue;
    for (const k of keys) {
      if (typeof k === "string" && MENU_REGISTRY_KEYS.has(k)) {
        pairs.push({ key: k, role });
      }
    }
  }

  const updatedBy = employee.employeeCode ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM app_menu_visibility`;
    for (const p of pairs) {
      await tx.$executeRaw`
        INSERT INTO app_menu_visibility (menu_key, role, updated_by, updated_at)
        VALUES (${p.key}, ${p.role}, ${updatedBy}, now())
        ON CONFLICT (menu_key, role)
        DO UPDATE SET updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
    }
  });

  return NextResponse.json({ ok: true, hidden: await getHiddenMenuMap() });
}
