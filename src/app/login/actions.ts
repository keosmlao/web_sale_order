"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  clearSessionCookie,
  hashPassword,
  isPasswordHash,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

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

  await setSessionCookie(employee.employeeCode!);
  redirect(await postLoginPath(employee.employeeCode!));
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
