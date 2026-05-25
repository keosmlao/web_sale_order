import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

type RouteContext = { params: Promise<{ id: string }> };

type ProductRow = {
  code: string;
  name_1: string;
  name_eng_1: string | null;
  unit_standard_name: string | null;
  item_brand: string | null;
  item_category: string | null;
  group_main: string | null;
  status: number | null;
  item_status: number | null;
  balance_qty: string | number | null;
  sale_price_kip: string | number | null;
};

type StockRow = {
  ic_code: string | null;
  ic_name: string | null;
  balance_qty: string | null;
  ic_unit_code: string | null;
  average_cost: string | null;
  average_cost_end: string | null;
  balance_amount: string | null;
};

function toProduct(row: ProductRow, stock?: StockRow) {
  return {
    id: row.code,
    code: row.code,
    name: row.name_1,
    description: row.name_eng_1,
    price: row.sale_price_kip ? Number(row.sale_price_kip) : 0,
    stock: stock?.balance_qty
      ? Number(stock.balance_qty)
      : row.balance_qty
        ? Number(row.balance_qty)
        : 0,
    imageUrl: null,
    unitName: stock?.ic_unit_code ?? row.unit_standard_name,
    brand: row.item_brand,
    category: row.item_category,
    groupMain: row.group_main,
    status: row.status,
    itemStatus: row.item_status,
    stockBalance: stock
      ? {
          code: stock.ic_code,
          name: stock.ic_name,
          balanceQty: stock.balance_qty ? Number(stock.balance_qty) : 0,
          unitCode: stock.ic_unit_code,
          averageCost: stock.average_cost ? Number(stock.average_cost) : 0,
          averageCostEnd: stock.average_cost_end
            ? Number(stock.average_cost_end)
            : 0,
          balanceAmount: stock.balance_amount
            ? Number(stock.balance_amount)
            : 0,
        }
      : null,
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rows = await prisma.$queryRaw<ProductRow[]>`
    SELECT
      code,
      name_1,
      name_eng_1,
      unit_standard_name,
      item_brand,
      item_category,
      group_main,
      status,
      item_status,
      balance_qty,
      price.sale_price_kip
    FROM ic_inventory i
    LEFT JOIN LATERAL (
      SELECT sale_price1 AS sale_price_kip
      FROM ic_inventory_price
      WHERE ic_code = i.code
        AND currency_code = '02'
        AND COALESCE(sale_price1, 0) > 0
        AND COALESCE(status, 1) = 1
      ORDER BY
        COALESCE(to_date, '2099-12-31'::date) DESC,
        COALESCE(from_date, '1900-01-01'::date) DESC,
        COALESCE(create_date_time_now, create_now) DESC,
        roworder DESC
      LIMIT 1
    ) price ON true
    WHERE i.code = ${id}
      AND i.name_1 IS NOT NULL
    LIMIT 1
  `;

  if (!rows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const stockRows = await prisma.$queryRaw<StockRow[]>`
    SELECT
      ic_code,
      ic_name,
      balance_qty,
      ic_unit_code,
      average_cost,
      average_cost_end,
      balance_amount
    FROM public.sml_ic_function_stock_balance(
      ${STOCK_BALANCE_AS_OF_DATE}::date,
      ${id}
    )
    LIMIT 1
  `;

  return NextResponse.json(toProduct(rows[0], stockRows[0]));
}

export async function PATCH() {
  return NextResponse.json(
    { error: "Products are read from ic_inventory and cannot be updated here" },
    { status: 405 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Products are read from ic_inventory and cannot be deleted here" },
    { status: 405 },
  );
}
