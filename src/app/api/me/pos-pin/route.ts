import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getEmployeeFromRequest,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

// /api/me/pos-pin
//
// PUT  — set or change my POS PIN. Body: { currentPin?: string, newPin: string }
//        If pos_pin_hash is already set, currentPin must verify against it.
//        First-time set: requires login password as currentPin (so a random
//        person with someone's session can't hijack their override creds).
// DELETE — clear my POS PIN. Body: { currentPin: string } — verified against
//        pos_pin_hash. After clearing, the manager-override endpoint falls
//        back to the login password.

type EmployeeRow = {
  pos_pin_hash: string | null;
  password: string | null;
};

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    currentPin?: unknown;
    newPin?: unknown;
  } | null;
  const currentPin =
    typeof body?.currentPin === "string" ? body.currentPin : "";
  const newPin = typeof body?.newPin === "string" ? body.newPin : "";

  if (!/^[\d]{4,12}$/.test(newPin)) {
    return NextResponse.json(
      { error: "PIN ໃໝ່ຕ້ອງເປັນຕົວເລກ 4-12 ໂຕ" },
      { status: 400 },
    );
  }

  const rows = await prisma.$queryRaw<EmployeeRow[]>`
    SELECT pos_pin_hash, password FROM odg_employee
    WHERE employee_code = ${employee.employeeCode}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { error: "ບໍ່ພົບຂໍ້ມູນພະນັກງານ" },
      { status: 404 },
    );
  }

  // First-time set verifies against login password; rotation verifies
  // against the existing PIN. Either way the user proves they own this
  // identity before the override credential changes.
  const referenceHash = row.pos_pin_hash ?? row.password;
  const ok = await verifyPassword(referenceHash, currentPin);
  if (!ok) {
    return NextResponse.json(
      {
        error: row.pos_pin_hash
          ? "PIN ປະຈຸບັນບໍ່ຖືກຕ້ອງ"
          : "ລະຫັດຜ່ານ login ບໍ່ຖືກຕ້ອງ",
      },
      { status: 403 },
    );
  }

  const newHash = await hashPassword(newPin);
  await prisma.$executeRaw`
    UPDATE odg_employee
    SET pos_pin_hash = ${newHash}
    WHERE employee_code = ${employee.employeeCode}
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    currentPin?: unknown;
  } | null;
  const currentPin =
    typeof body?.currentPin === "string" ? body.currentPin : "";
  const rows = await prisma.$queryRaw<EmployeeRow[]>`
    SELECT pos_pin_hash FROM odg_employee
    WHERE employee_code = ${employee.employeeCode}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.pos_pin_hash) {
    return NextResponse.json({ ok: true });
  }
  const ok = await verifyPassword(row.pos_pin_hash, currentPin);
  if (!ok) {
    return NextResponse.json(
      { error: "PIN ປະຈຸບັນບໍ່ຖືກຕ້ອງ" },
      { status: 403 },
    );
  }
  await prisma.$executeRaw`
    UPDATE odg_employee
    SET pos_pin_hash = NULL
    WHERE employee_code = ${employee.employeeCode}
  `;
  return NextResponse.json({ ok: true });
}
