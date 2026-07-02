"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  clearSessionCookie,
  hashPassword,
  isPasswordHash,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { verifyPayload } from "@/lib/line";

export type LoginState = { error?: string };

async function postLoginPath(employeeCode: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ app_role: string | null }>>`
    SELECT app_role
    FROM app_employee_access
    WHERE employee_code = ${employeeCode}
      AND is_active = true
    LIMIT 1
  `;
  const explicitRole = rows[0]?.app_role?.trim().toLowerCase();
  return explicitRole === "pc" || explicitRole === "salesperson"
    ? "/orders/new"
    : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const code = String(formData.get("code") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!code || !password) {
    return { error: "ກະລຸນາປ້ອນລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ" };
  }

  const employee = await prisma.odgEmployee.findUnique({
    where: { employeeCode: code },
  });

  if (!employee || !(await verifyPassword(employee.password, password))) {
    return { error: "ລະຫັດພະນັກງານ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" };
  }

  if (employee.employmentStatus && employee.employmentStatus !== "ACTIVE") {
    return { error: "ບັນຊີນີ້ບໍ່ໄດ້ຖືກເປີດໃຊ້ງານ" };
  }

  if (!isPasswordHash(employee.password)) {
    await prisma.odgEmployee.update({
      where: { employeeCode: code },
      data: { password: await hashPassword(password) },
    });
  }

  // If this login was reached from an unlinked LINE sign-in (pending cookie
  // set by /api/auth/line/callback), link that LINE account now — silently.
  // Next time the LINE button signs them straight in.
  const jar = await cookies();
  const pendingLine = verifyPayload<{ lineUserId: string; displayName: string }>(
    jar.get("line_link_pending")?.value,
  );
  if (pendingLine?.lineUserId) {
    // odg_employee.line_id is the primary LINE↔employee mapping (already
    // populated for most staff via the LINE OA); app_employee_line keeps the
    // display name + link history.
    await prisma.$executeRaw`
      UPDATE odg_employee SET line_id = ${pendingLine.lineUserId}
      WHERE employee_code = ${employee.employeeCode}
    `.catch(() => undefined);
    await prisma.$executeRaw`
      INSERT INTO app_employee_line (line_user_id, employee_code, display_name)
      VALUES (${pendingLine.lineUserId}, ${employee.employeeCode}, ${pendingLine.displayName})
      ON CONFLICT (line_user_id)
      DO UPDATE SET employee_code = EXCLUDED.employee_code,
                    display_name = EXCLUDED.display_name
    `.catch(() => undefined);
    jar.delete("line_link_pending");
  }

  await setSessionCookie(employee.employeeCode!);
  redirect(await postLoginPath(employee.employeeCode!));
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
