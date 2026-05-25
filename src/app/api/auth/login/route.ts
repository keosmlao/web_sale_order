import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!code || !password) {
    return NextResponse.json(
      { error: "ກະລຸນາປ້ອນລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ" },
      { status: 400 },
    );
  }

  const employee = await prisma.odgEmployee.findUnique({
    where: { employeeCode: code },
  });

  if (!employee || !(await verifyPassword(employee.password, password))) {
    return NextResponse.json(
      { error: "ລະຫັດພະນັກງານ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" },
      { status: 401 },
    );
  }

  if (employee.employmentStatus && employee.employmentStatus !== "ACTIVE") {
    return NextResponse.json(
      { error: "ບັນຊີນີ້ບໍ່ໄດ້ຖືກເປີດໃຊ້ງານ" },
      { status: 403 },
    );
  }

  if (!isPasswordHash(employee.password)) {
    await prisma.odgEmployee.update({
      where: { employeeCode: code },
      data: { password: await hashPassword(password) },
    });
  }

  const token = createSessionToken(employee.employeeCode!);

  return NextResponse.json({
    token,
    employee: {
      employeeId: employee.employeeId,
      employeeCode: employee.employeeCode,
      fullnameLo: employee.fullnameLo,
      fullnameEn: employee.fullnameEn,
      nickname: employee.nickname,
      positionCode: employee.positionCode,
      appRole: roleFromEmployee(employee),
    },
  });
}
