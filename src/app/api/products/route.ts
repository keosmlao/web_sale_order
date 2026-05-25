import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

type ProductRow = {
  code: string;
  name_1: string;
  name_eng_1: string | null;
  unit_standard_name: string | null;
  item_brand: string | null;
  item_category: string | null;
  category_name: string | null;
  group_main: string | null;
  group_main_name: string | null;
  balance_qty: string | number | null;
  minimum_stock: string | number | null;
  sale_price_kip: string | number | null;
  has_set: boolean | null;
};

function isAirProduct(row: Pick<ProductRow, "item_category" | "group_main">) {
  return row.item_category?.trim() === "032" || row.group_main?.trim() === "12";
}

function hasSetComposition(row: Pick<ProductRow, "has_set">) {
  return row.has_set === true;
}

function visibleInPos(row: ProductRow) {
  return !isAirProduct(row) || hasSetComposition(row);
}

function toProduct(row: ProductRow) {
  const airSet = isAirProduct(row) && hasSetComposition(row);
  const stock = row.balance_qty ? Number(row.balance_qty) : 0;
  const minimumStock = row.minimum_stock ? Number(row.minimum_stock) : 0;
  return {
    id: row.code,
    code: row.code,
    name: row.name_1,
    description: row.name_eng_1,
    price: row.sale_price_kip ? Number(row.sale_price_kip) : 0,
    stock: airSet ? Math.max(stock, 1) : stock,
    minimumStock,
    imageUrl: null,
    unitName: airSet ? "ຊຸດ" : row.unit_standard_name,
    brand: row.item_brand,
    category: row.item_category,
    categoryName: row.category_name,
    groupMain: row.group_main,
    groupMainName: row.group_main_name,
    hasSet: airSet,
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const warehouseParam =
    request.nextUrl.searchParams.get("warehouses") ??
    request.nextUrl.searchParams.get("warehouse");
  const requestedWarehouses = warehouseParam
    ? warehouseParam
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
    : [];
  const salesWarehouses =
    requestedWarehouses.length > 0
      ? requestedWarehouses
      : await getConfiguredSalesWarehouses();
  const warehouseList = salesWarehouses.join(",");

  // Keep the initial POS catalog cheap. The live sales-warehouse balance
  // function is expensive across the full catalog and can hit statement
  // timeouts; add-to-cart already calls /api/inventory/stock-balance for the
  // selected item before a line is accepted. Here we use ic_inventory.balance_qty
  // as a catalog-level prefilter/display cache.
  const products = await prisma.$queryRaw<ProductRow[]>`
    WITH min_stock AS (
      SELECT item_code, SUM(min_qty) AS minimum_stock
      FROM app_stock_minimum
      WHERE warehouse_code = ANY(string_to_array(${warehouseList}, ','))
      GROUP BY item_code
    ),
    latest_price AS (
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
    set_codes AS (
      SELECT DISTINCT ic_set_code
      FROM ic_inventory_set_detail
      WHERE COALESCE(status, 0) <> 1
    )
    SELECT
      i.code,
      i.name_1,
      i.name_eng_1,
      i.unit_standard_name,
      i.item_brand,
      i.item_category,
      cat.name_1 AS category_name,
      i.group_main,
      grp.name_1 AS group_main_name,
      COALESCE(i.balance_qty, 0) AS balance_qty,
      COALESCE(ms.minimum_stock, 0) AS minimum_stock,
      price.sale_price_kip,
      (sc.ic_set_code IS NOT NULL) AS has_set
    FROM ic_inventory i
    LEFT JOIN ic_category cat ON cat.code = i.item_category
    LEFT JOIN ic_group grp ON grp.code = i.group_main
    LEFT JOIN min_stock ms ON ms.item_code = i.code
    LEFT JOIN latest_price price ON price.ic_code = i.code
    LEFT JOIN set_codes sc ON sc.ic_set_code = i.code
    WHERE i.name_1 IS NOT NULL
      AND COALESCE(i.status, 0) <> 1
      AND (
        COALESCE(i.balance_qty, 0) > 0
        OR (
          (i.item_category = '032' OR i.group_main = '12')
          AND sc.ic_set_code IS NOT NULL
        )
      )
    ORDER BY i.code
  `;

  return NextResponse.json(products.filter(visibleInPos).map(toProduct));
}

export async function POST() {
  return NextResponse.json(
    { error: "Products are read from ic_inventory and cannot be created here" },
    { status: 405 },
  );
}
