import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// GET /api/cashier/redeem-info?cartNumber=050001
//
// Returns everything the cashier UI needs to render the "use loyalty points"
// box for a specific cart: the active loyalty config (redeem rate + min) and
// the cart's customer balance (or null when the cart is a walk-in sale).

type ConfigRow = {
  redeem_points_per_kip: string | number | null;
  min_redeem_points: string | number | null;
  is_active: boolean | null;
  point_name: string | null;
};

type CustomerRow = {
  cust_code: string | null;
  point_balance: string | number | null;
  customer_name: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const cartNumber = url.searchParams.get("cartNumber")?.trim() ?? "";
  if (!cartNumber) {
    return NextResponse.json(
      { error: "cartNumber required" },
      { status: 400 },
    );
  }

  const [configRows, custRows] = await Promise.all([
    prisma.$queryRaw<ConfigRow[]>`
      SELECT redeem_points_per_kip, min_redeem_points, is_active, point_name
      FROM app_loyalty_config
      WHERE is_active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    prisma.$queryRaw<CustomerRow[]>`
      SELECT
        t.cust_code,
        ar.point_balance,
        ar.name_1 AS customer_name
      FROM ic_trans t
      LEFT JOIN ar_customer ar ON ar.code = t.cust_code
      WHERE t.doc_format_code = 'SOK'
        AND SUBSTRING(t.doc_no FROM 6) = ${cartNumber}
      ORDER BY t.create_date_time_now DESC
      LIMIT 1
    `,
  ]);

  const cfg = configRows[0];
  const redeemRate = cfg?.redeem_points_per_kip
    ? Number(cfg.redeem_points_per_kip)
    : 0;
  const cust = custRows[0];

  return NextResponse.json({
    isActive: cfg?.is_active === true && redeemRate > 0,
    redeemPointsPerKip: redeemRate,
    minRedeemPoints: cfg?.min_redeem_points
      ? Number(cfg.min_redeem_points)
      : 0,
    pointName: cfg?.point_name?.trim() || null,
    customerCode: cust?.cust_code ?? null,
    customerName: cust?.customer_name ?? null,
    pointBalance: cust?.point_balance ? Number(cust.point_balance) : 0,
  });
}
