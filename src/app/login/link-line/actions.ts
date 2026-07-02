"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  isPasswordHash,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { verifyPayload } from "@/lib/line";

export type LinkLineState = { error?: string };

type PendingLink = { lineUserId: string; displayName: string };

// One-time step after the first LINE sign-in: verify the employee's normal
// credentials, store the LINE ↔ employee link, then start the session. Next
// LINE sign-ins skip straight in.
export async function linkLineAction(
  _prev: LinkLineState,
  formData: FormData,
): Promise<LinkLineState> {
  const jar = await cookies();
  const pending = verifyPayload<PendingLink>(jar.get("line_link_pending")?.value);
  if (!pending?.lineUserId) {
    return { error: "ການເຊື່ອມ LINE ໝົດອາຍຸ — ກະລຸນາເລີ່ມໃໝ່" };
  }

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

  await prisma.$executeRaw`
    INSERT INTO app_employee_line (line_user_id, employee_code, display_name)
    VALUES (${pending.lineUserId}, ${employee.employeeCode}, ${pending.displayName})
    ON CONFLICT (line_user_id)
    DO UPDATE SET employee_code = EXCLUDED.employee_code,
                  display_name = EXCLUDED.display_name
  `;

  jar.delete("line_link_pending");
  await setSessionCookie(employee.employeeCode!);

  const rows = await prisma.$queryRaw<Array<{ app_role: string | null }>>`
    SELECT app_role FROM app_employee_access
    WHERE employee_code = ${employee.employeeCode} AND is_active = true
    LIMIT 1
  `;
  const role = rows[0]?.app_role?.trim().toLowerCase();
  redirect(role === "pc" || role === "salesperson" ? "/orders/new" : "/");
}
