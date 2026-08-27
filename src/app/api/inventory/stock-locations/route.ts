import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";
import { committedStockCte } from "@/lib/committed-stock";

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
  on_hand: number | null;
  committed_qty: number | null;
  held_by: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const code = (request.nextUrl.searchParams.get("code") ?? "").trim();
  // The order being edited must not be counted against itself.
  const excludeDocNo = (
    request.nextUrl.searchParams.get("excludeDocNo") ?? ""
  ).trim();
  if (!code) {
    return NextResponse.json(
      { error: "Missing item code" },
      { status: 400 },
    );
  }

  const rows = await prisma.$queryRaw<Row[]>`
    WITH committed AS (${committedStockCte(excludeDocNo)})
    SELECT
      b.warehouse,
      wh.name_1 AS warehouse_name,
      b.location,
      sh.name_1 AS location_name,
      -- What can still be sold: on the shelf, less what open orders have
      -- already promised from that shelf. Never negative — an oversold
      -- shelf is zero available, not a negative that reads as a credit.
      GREATEST(
        0,
        FLOOR(COALESCE(b.balance_qty, 0) - COALESCE(c.qty, 0))
      )::int AS balance_qty,
      FLOOR(COALESCE(b.balance_qty, 0))::int AS on_hand,
      COALESCE(c.qty, 0)::int AS committed_qty,
      c.held_by
    FROM public.sml_ic_function_stock_balance_warehouse_location(
      ${STOCK_BALANCE_AS_OF_DATE}::date,
      ${code},
      '',
      ''
    ) b
    LEFT JOIN ic_warehouse wh ON wh.code = b.warehouse
    LEFT JOIN ic_shelf sh ON sh.whcode = b.warehouse AND sh.code = b.location
    LEFT JOIN committed c
      ON c.item_code = ${code}
     AND c.wh_code = b.warehouse
     AND c.shelf_code = b.location
    WHERE COALESCE(b.balance_qty, 0) >= 1
    ORDER BY balance_qty DESC, b.warehouse, b.location
  `;

  return NextResponse.json({
    code,
    locations: rows.map((r) => ({
      warehouse: r.warehouse,
      warehouseName: r.warehouse_name,
      location: r.location,
      locationName: r.location_name,
      balanceQty: r.balance_qty ?? 0,
      // What is on the shelf and what is already promised off it, so the
      // picker can say "1 there, 4 waiting on a receipt" instead of just
      // refusing.
      onHand: r.on_hand ?? 0,
      committedQty: r.committed_qty ?? 0,
      heldBy: r.held_by,
    })),
  });
}
