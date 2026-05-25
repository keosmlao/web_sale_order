import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

// /api/cashier/low-stock
//
// Lists sales-warehouse items whose live balance has dropped at or below
// the configured minimum stock threshold. Cashier-page banner uses this
// so the floor knows which SKUs to restock before they sell out.

type Row = {
  ic_code: string;
  ic_name: string | null;
  warehouse: string;
  warehouse_name: string | null;
  balance_qty: string | number | null;
  min_qty: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salesWarehouses = await getConfiguredSalesWarehouses();
  if (salesWarehouses.length === 0) {
    return NextResponse.json({ rows: [] });
  }
  const whList = salesWarehouses.join(",");

  // The min-stock table is per (warehouse, item). We join against the
  // live balance function so the banner reflects what the floor can
  // actually pull from. Only return rows where the threshold is set
  // (min_qty > 0) AND current balance is at or below it.
  const rows = await prisma.$queryRaw<Row[]>`
    WITH balance AS (
      SELECT ic_code, warehouse, SUM(balance_qty) AS balance_qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        '2099-12-31'::date, '', ${whList}
      )
      GROUP BY ic_code, warehouse
    )
    SELECT
      ms.item_code AS ic_code,
      i.name_1     AS ic_name,
      ms.warehouse_code AS warehouse,
      wh.name_1    AS warehouse_name,
      COALESCE(b.balance_qty, 0) AS balance_qty,
      ms.min_qty
    FROM app_stock_minimum ms
    LEFT JOIN ic_inventory i ON i.code = ms.item_code
    LEFT JOIN ic_warehouse wh ON wh.code = ms.warehouse_code
    LEFT JOIN balance b
      ON b.ic_code   = ms.item_code
     AND b.warehouse = ms.warehouse_code
    WHERE ms.warehouse_code = ANY(string_to_array(${whList}, ','))
      AND ms.min_qty > 0
      AND COALESCE(b.balance_qty, 0) <= ms.min_qty
    ORDER BY (COALESCE(b.balance_qty, 0) - ms.min_qty), ms.item_code
    LIMIT 100
  `;

  return NextResponse.json({
    rows: rows.map((r) => ({
      itemCode: r.ic_code,
      itemName: r.ic_name?.trim() ?? r.ic_code,
      warehouseCode: r.warehouse,
      warehouseName: r.warehouse_name?.trim() ?? r.warehouse,
      balanceQty: r.balance_qty ? Number(r.balance_qty) : 0,
      minQty: r.min_qty ? Number(r.min_qty) : 0,
    })),
  });
}
