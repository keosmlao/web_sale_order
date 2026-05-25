import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import LoyaltyClient from "./LoyaltyClient";

export const dynamic = "force-dynamic";

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

export default async function LoyaltyPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canManage = role === "manager" || role === "head";

  // Read the latest config directly via SQL — the table is small, and a
  // disabled latest row still matters because the UI must show the off state.
  const rows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT id, earn_kip_per_point, redeem_points_per_kip,
           min_redeem_points, point_name, is_active, note,
           updated_by, created_at, updated_at
    FROM app_loyalty_config
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  const initialConfig = row
    ? {
        id: row.id.toString(),
        earnKipPerPoint: row.earn_kip_per_point
          ? Number(row.earn_kip_per_point)
          : 0,
        redeemPointsPerKip: row.redeem_points_per_kip
          ? Number(row.redeem_points_per_kip)
          : 0,
        minRedeemPoints: row.min_redeem_points
          ? Number(row.min_redeem_points)
          : 0,
        pointName: row.point_name?.trim() || null,
        isActive: row.is_active === true,
        note: row.note?.trim() || null,
        updatedBy: row.updated_by?.trim() || null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      }
    : null;

  return <LoyaltyClient initialConfig={initialConfig} canManage={canManage} />;
}
