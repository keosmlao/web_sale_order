import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Commission bases for manager (position 11) / unit head (position 12), per
// product group — see sql/add-incentive-role-commission.sql. Paid on the
// TEAM's achievement of each group with the same 5%-step rate rule.

const POSITIONS = ["11", "12", "13"] as const;
const GROUPS = ["CE_SDA", "AIR", "ALL", "ONLINE"] as const;

type Line = { positionCode: string; groupCode: string; baseAmount: number };

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rows = await prisma.$queryRaw<Array<{
      position_code: string;
      group_code: string;
      base_amount: string | number | null;
    }>>`
      SELECT position_code, group_code, base_amount
      FROM app_incentive_role_commission
    `;
    return NextResponse.json({
      lines: rows.map((r) => ({
        positionCode: r.position_code,
        groupCode: r.group_code,
        baseAmount: Number(r.base_amount ?? 0),
      })),
    });
  } catch {
    // Table not migrated yet.
    return NextResponse.json({ lines: null });
  }
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = roleFromEmployee(employee);
  if (role !== "manager" && role !== "head") {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ Config Incentive" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { lines?: Line[] } | null;
  const lines = (body?.lines ?? []).filter(
    (l) =>
      POSITIONS.includes(l.positionCode as (typeof POSITIONS)[number]) &&
      GROUPS.includes(l.groupCode as (typeof GROUPS)[number]) &&
      Number.isFinite(Number(l.baseAmount)) &&
      Number(l.baseAmount) >= 0,
  );
  if (lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີຂໍ້ມູນທີ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  try {
    for (const l of lines) {
      await prisma.$executeRaw`
        INSERT INTO app_incentive_role_commission (position_code, group_code, base_amount)
        VALUES (${l.positionCode}, ${l.groupCode}, ${Number(l.baseAmount)})
        ON CONFLICT (position_code, group_code)
        DO UPDATE SET base_amount = EXCLUDED.base_amount
      `;
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "ຕາຕະລາງຍັງບໍ່ຖືກສ້າງ — ຮັນ sql/add-incentive-role-commission.sql ກ່ອນ" },
      { status: 503 },
    );
  }
}
