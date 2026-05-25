import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  getConfiguredSalesWarehouses,
  STOCK_BALANCE_AS_OF_DATE,
} from "@/lib/inventory-config";

type Row = {
  ic_code: string | null;
  sales_balance: string | null;
  minimum_stock: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional override: ?warehouses=1102,1103 (caller filters to specific warehouses).
  // Default: the env-configured sales warehouses.
  const wParam = request.nextUrl.searchParams.get("warehouses");
  const override = wParam
    ? wParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : null;
  const warehouses =
    override && override.length > 0
      ? override
      : await getConfiguredSalesWarehouses();
  const warehouseList = warehouses.join(",");

  // Get full code list from ic_inventory, then aggregate balance from sales warehouses.
  const rows = await prisma.$queryRaw<Row[]>`
    WITH codes AS (
      SELECT string_agg(code, ',') AS list
      FROM ic_inventory
      WHERE name_1 IS NOT NULL
    ),
    balances AS (
      SELECT
        ic_code,
        SUM(balance_qty) AS sales_balance
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        (SELECT list FROM codes),
        ${warehouseList}
      )
      GROUP BY ic_code
    ),
    min_stock AS (
      SELECT item_code, SUM(min_qty) AS minimum_stock
      FROM app_stock_minimum
      WHERE warehouse_code = ANY(string_to_array(${warehouseList}, ','))
      GROUP BY item_code
    )
    SELECT
      b.ic_code,
      b.sales_balance,
      COALESCE(ms.minimum_stock, 0) AS minimum_stock
    FROM balances b
    LEFT JOIN min_stock ms ON ms.item_code = b.ic_code
    WHERE COALESCE(b.sales_balance, 0) > 0
  `;

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    warehouses,
    items: rows.map((r) => ({
      code: r.ic_code,
      salesBalance: r.sales_balance ? Number(r.sales_balance) : 0,
      minimumStock: r.minimum_stock ? Number(r.minimum_stock) : 0,
    })),
  });
}
