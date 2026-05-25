"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { canAssignRoles, isValidRole, roleFromEmployee } from "@/lib/roles";

export type ActionResult = { ok: true } | { ok: false; error: string };

function s(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function boolFromForm(v: unknown): boolean {
  return v === "true" || v === "on" || v === "1";
}

async function requireRoleManager(): Promise<string | ActionResult> {
  const me = await requireEmployee();
  if (!canAssignRoles(roleFromEmployee(me))) {
    return { ok: false, error: "ສະເພາະຫົວໜ້າ ຫຼື ຜູ້ຈັດການ ຈັດການສິດໄດ້" };
  }
  return me.employeeCode ?? "";
}

export async function createEmployeeAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await requireRoleManager();
  if (typeof actor !== "string") return actor;

  const employeeCode = s(form.get("employeeCode"));
  const appRole = s(form.get("appRole"));
  const positionCode = s(form.get("positionCode"));
  const isActive = boolFromForm(form.get("isActive"));

  if (!employeeCode) return { ok: false, error: "ກະລຸນາປ້ອນລະຫັດພະນັກງານ" };
  if (!appRole || !isValidRole(appRole)) {
    return { ok: false, error: "ກະລຸນາເລືອກສິດໃຫ້ຖືກຕ້ອງ" };
  }

  const employee = await prisma.odgEmployee.findUnique({
    where: { employeeCode },
    select: { employeeCode: true },
  });
  if (!employee) {
    return { ok: false, error: "ບໍ່ພົບລະຫັດພະນັກງານນີ້ໃນ odg_employee" };
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO app_employee_access (
        employee_code, app_role, position_code, is_active, created_by, updated_by
      )
      VALUES (${employeeCode}, ${appRole}, ${positionCode}, ${isActive}, ${actor}, ${actor})
    `;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("23505") || msg.toLowerCase().includes("unique")) {
      return { ok: false, error: "ພະນັກງານນີ້ຖືກເພີ່ມເຂົ້າ app ແລ້ວ" };
    }
    return { ok: false, error: "ບໍ່ສາມາດເພີ່ມໄດ້: " + msg };
  }

  revalidatePath("/employees");
  return { ok: true };
}

export async function updateEmployeeAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await requireRoleManager();
  if (typeof actor !== "string") return actor;

  const employeeCode = s(form.get("employeeCode"));
  const appRole = s(form.get("appRole"));
  const positionCode = s(form.get("positionCode"));
  const isActive = boolFromForm(form.get("isActive"));

  if (!employeeCode) return { ok: false, error: "ບໍ່ມີລະຫັດພະນັກງານ" };
  if (!appRole || !isValidRole(appRole)) {
    return { ok: false, error: "ກະລຸນາເລືອກສິດໃຫ້ຖືກຕ້ອງ" };
  }

  await prisma.$executeRaw`
    UPDATE app_employee_access
    SET app_role = ${appRole},
        position_code = ${positionCode},
        is_active = ${isActive},
        updated_by = ${actor},
        updated_at = NOW()
    WHERE employee_code = ${employeeCode}
  `;

  revalidatePath("/employees");
  return { ok: true };
}

export async function setRoleAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const actor = await requireRoleManager();
  if (typeof actor !== "string") return actor;

  const employeeCode = s(form.get("employeeCode"));
  const appRole = s(form.get("appRole"));
  if (!employeeCode) return { ok: false, error: "ບໍ່ມີລະຫັດພະນັກງານ" };
  if (!appRole || !isValidRole(appRole)) {
    return { ok: false, error: "appRole ບໍ່ຖືກຕ້ອງ" };
  }

  await prisma.$executeRaw`
    UPDATE app_employee_access
    SET app_role = ${appRole},
        updated_by = ${actor},
        updated_at = NOW()
    WHERE employee_code = ${employeeCode}
  `;
  revalidatePath("/employees");
  return { ok: true };
}

export async function deleteEmployeeAction(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const me = await requireEmployee();
  if (!canAssignRoles(roleFromEmployee(me))) {
    return { ok: false, error: "ສະເພາະຫົວໜ້າ ຫຼື ຜູ້ຈັດການ ຈັດການສິດໄດ້" };
  }
  const employeeCode = s(form.get("employeeCode"));
  if (!employeeCode) return { ok: false, error: "ບໍ່ມີລະຫັດພະນັກງານ" };
  if (me.employeeCode === employeeCode) {
    return { ok: false, error: "ບໍ່ສາມາດລຶບສິດຂອງຕົນເອງ" };
  }

  await prisma.$executeRaw`
    DELETE FROM app_employee_access
    WHERE employee_code = ${employeeCode}
  `;
  revalidatePath("/employees");
  return { ok: true };
}
