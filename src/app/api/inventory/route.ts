import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

type Row = {
  code: string;
  name_1: string | null;
  name_eng_1: string | null;
  unit_standard_name: string | null;
  item_brand: string | null;
  brand_name: string | null;
  item_category: string | null;
  category_name: string | null;
  group_main: string | null;
  group_main_name: string | null;
  status: number | null;
  item_status: number | null;
  balance_qty: string | null;
  sales_minimum_stock: string | null;
  sale_price_kip: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const salesWarehouses = await getConfiguredSalesWarehouses();
  const warehouseList = salesWarehouses.join(",");

  // Precompute the latest active KIP price per item in ONE pass with DISTINCT ON,
  // then plain LEFT JOIN. Avoids the LATERAL subquery (which re-sorts the price
  // table once per inventory row — quadratic-ish on a multi-thousand row catalog).
  const rows = await prisma.$queryRaw<Row[]>`
    WITH latest_price AS (
      SELECT DISTINCT ON (ic_code)
        ic_code,
        sale_price1 AS sale_price_kip
      FROM ic_inventory_price
      WHERE currency_code = '02'
        AND COALESCE(sale_price1, 0) > 0
        AND COALESCE(status, 1) = 1
      ORDER BY
        ic_code,
        COALESCE(to_date, '2099-12-31'::date) DESC,
        COALESCE(from_date, '1900-01-01'::date) DESC,
        COALESCE(create_date_time_now, create_now) DESC,
        roworder DESC
    ),
    min_stock AS (
      SELECT item_code, SUM(min_qty) AS sales_minimum_stock
      FROM app_stock_minimum
      WHERE warehouse_code = ANY(string_to_array(${warehouseList}, ','))
      GROUP BY item_code
    )
    SELECT
      i.code,
      i.name_1,
      i.name_eng_1,
      i.unit_standard_name,
      i.item_brand,
      br.name_1 AS brand_name,
      i.item_category,
      cat.name_1 AS category_name,
      i.group_main,
      grp.name_1 AS group_main_name,
      i.status,
      i.item_status,
      i.balance_qty,
      COALESCE(ms.sales_minimum_stock, 0) AS sales_minimum_stock,
      price.sale_price_kip
    FROM ic_inventory i
    LEFT JOIN ic_brand br ON br.code = i.item_brand
    LEFT JOIN ic_category cat ON cat.code = i.item_category
    LEFT JOIN ic_group grp ON grp.code = i.group_main
    LEFT JOIN latest_price price ON price.ic_code = i.code
    LEFT JOIN min_stock ms ON ms.item_code = i.code
    WHERE i.name_1 IS NOT NULL
    ORDER BY i.code
  `;

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    count: rows.length,
    salesWarehouses,
    items: rows.map((r) => ({
      code: r.code,
      nameLo: r.name_1,
      nameEng: r.name_eng_1,
      unitName: r.unit_standard_name,
      brand: r.item_brand,
      brandName: r.brand_name,
      category: r.item_category,
      categoryName: r.category_name,
      groupMain: r.group_main,
      groupMainName: r.group_main_name,
      status: r.status,
      itemStatus: r.item_status,
      companyBalance: r.balance_qty ? Number(r.balance_qty) : 0,
      salesMinimumStock: r.sales_minimum_stock
        ? Number(r.sales_minimum_stock)
        : 0,
      salePriceKip: r.sale_price_kip ? Number(r.sale_price_kip) : 0,
    })),
  });
}
