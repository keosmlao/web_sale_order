import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Loyalty / points-collection config.
//
//   GET  /api/loyalty/config — return the latest config (or null if unset)
//   PUT  /api/loyalty/config — manager-only; deactivates the existing
//                              active row and inserts a fresh row so we
//                              keep a history of rate changes.

type ConfigRow = {
  id: bigint;
  earn_kip_per_point: string | number | null;
  redeem_points_per_kip: string | number | null;
  min_redeem_points: string | number | null;
  point_name: string | null;
  is_active: boolean | null;
  note: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function toConfig(row: ConfigRow) {
  return {
    id: row.id.toString(),
    earnKipPerPoint: row.earn_kip_per_point ? Number(row.earn_kip_per_point) : 0,
    redeemPointsPerKip: row.redeem_points_per_kip
      ? Number(row.redeem_points_per_kip)
      : 0,
    minRedeemPoints: row.min_redeem_points ? Number(row.min_redeem_points) : 0,
    pointName: row.point_name?.trim() || null,
    isActive: row.is_active === true,
    note: row.note?.trim() || null,
    updatedBy: row.updated_by?.trim() || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT id, earn_kip_per_point, redeem_points_per_kip,
           min_redeem_points, point_name, is_active, note,
           updated_by, created_at, updated_at
    FROM app_loyalty_config
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return NextResponse.json({ config: rows[0] ? toConfig(rows[0]) : null });
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Only managers and admins can update loyalty rates. Salespeople / cashiers
  // see the page in read-only mode; the API is the second line of defence.
  const role = roleFromEmployee(employee);
  if (role !== "manager" && role !== "head") {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດແກ້ໄຂການຕັ້ງຄ່າແຕ້ມສະສົມ" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    earnKipPerPoint?: unknown;
    redeemPointsPerKip?: unknown;
    minRedeemPoints?: unknown;
    pointName?: unknown;
    note?: unknown;
    isActive?: unknown;
  } | null;

  const earn = Number(body?.earnKipPerPoint);
  // Redeem rate: how many points the cashier deducts from the customer's
  // balance to forgive 1 KIP of the bill. 0 (or unset) disables redemption.
  const redeemRaw = Number(body?.redeemPointsPerKip);
  const redeem = Number.isFinite(redeemRaw) && redeemRaw > 0 ? redeemRaw : 0;
  const minRedeemRaw = Number(body?.minRedeemPoints);
  const minRedeem =
    Number.isFinite(minRedeemRaw) && minRedeemRaw >= 0 ? minRedeemRaw : 0;
  const pointName =
    typeof body?.pointName === "string" && body.pointName.trim()
      ? body.pointName.trim().slice(0, 50)
      : null;
  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  const isActive = body?.isActive !== false;

  if (!Number.isFinite(earn) || earn <= 0) {
    return NextResponse.json(
      { error: "ກີບຕໍ່ແຕ້ມ (earn) ຕ້ອງເປັນຕົວເລກ > 0" },
      { status: 400 },
    );
  }
  const inserted = await prisma.$transaction(async (tx) => {
    // Deactivate previous active rows so only one config is "current".
    // History is preserved (is_active=FALSE) so future audit / undo is
    // trivial without needing a separate archive table.
    await tx.$executeRaw`
      UPDATE app_loyalty_config SET is_active = FALSE WHERE is_active = TRUE
    `;
    const rows = await tx.$queryRaw<ConfigRow[]>`
      INSERT INTO app_loyalty_config (
        earn_kip_per_point, redeem_points_per_kip, min_redeem_points,
        point_name, is_active, note, updated_by
      )
      VALUES (
        ${earn}, ${redeem}, ${minRedeem},
        ${pointName}, ${isActive}, ${note}, ${employee.employeeCode ?? null}
      )
      RETURNING id, earn_kip_per_point, redeem_points_per_kip,
                min_redeem_points, point_name, is_active, note,
                updated_by, created_at, updated_at
    `;
    return rows[0];
  });

  return NextResponse.json({ config: toConfig(inserted) });
}
