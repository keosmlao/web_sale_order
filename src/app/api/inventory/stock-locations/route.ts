import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

// Per-item warehouse+location breakdown — called by the mobile app right
// after the cashier picks a product, so the warehouse picker can show
// where stock actually lives. Joins ic_warehouse + ic_shelf to surface
// human-readable names alongside the codes.
type Row = {
  warehouse: string | null;
  warehouse_name: string | null;
  location: string | null;
  location_name: string | null;
  balance_qty: number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  if (!code) {
    return NextResponse.json(
      { error: "Missing item code" },
      { status: 400 },
    );
  }

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      b.warehouse,
      wh.name_1 AS warehouse_name,
      b.location,
      sh.name_1 AS location_name,
      b.balance_qty::int AS balance_qty
    FROM public.sml_ic_function_stock_balance_warehouse_location(
      ${STOCK_BALANCE_AS_OF_DATE}::date,
      ${code},
      '',
      ''
    ) b
    LEFT JOIN ic_warehouse wh ON wh.code = b.warehouse
    LEFT JOIN ic_shelf sh ON sh.whcode = b.warehouse AND sh.code = b.location
    WHERE COALESCE(b.balance_qty, 0) > 0
    ORDER BY b.balance_qty DESC, b.warehouse, b.location
  `;

  return NextResponse.json({
    code,
    locations: rows.map((r) => ({
      warehouse: r.warehouse,
      warehouseName: r.warehouse_name,
      location: r.location,
      locationName: r.location_name,
      balanceQty: r.balance_qty ?? 0,
    })),
  });
}
