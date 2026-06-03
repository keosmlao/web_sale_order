import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

// In-stock products for a single warehouse — backs the price-tags "load from
// warehouse" picker. Balance comes from the live warehouse stock function;
// name / unit / latest active KIP price are joined from ic_inventory. Only
// items with a positive balance in that warehouse are returned.
type Row = {
  code: string;
  name_1: string | null;
  name_eng_1: string | null;
  unit_standard_name: string | null;
  balance_qty: string | number | null;
  sale_price_kip: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const warehouse = (sp.get("warehouse") ?? "").trim();
  if (!warehouse) {
    return NextResponse.json({ error: "warehouse required" }, { status: 400 });
  }
  const q = (sp.get("q") ?? "").trim();
  const like = `%${q}%`;
  const search = q
    ? Prisma.sql`AND (i.code ILIKE ${like} OR COALESCE(i.name_1, '') ILIKE ${like} OR COALESCE(i.name_eng_1, '') ILIKE ${like})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>`
    WITH codes AS (
      -- Only feed the (company-wide) in-stock items into the live per-warehouse
      -- balance function. Passing the full catalog (~24k codes) makes the
      -- function call exceed the 30s read timeout; the cached
      -- ic_inventory.balance_qty prefilter (~9.5k codes) brings it to a few
      -- seconds. An item with zero company balance cannot be positive in a
      -- single warehouse, so this does not drop any real warehouse stock.
      SELECT string_agg(code, ',') AS list
      FROM ic_inventory
      WHERE name_1 IS NOT NULL
        AND COALESCE(balance_qty, 0) > 0
    ),
    balances AS (
      SELECT ic_code, SUM(balance_qty) AS balance_qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        (SELECT list FROM codes),
        ${warehouse}
      )
      GROUP BY ic_code
      HAVING SUM(balance_qty) > 0
    )
    SELECT
      i.code,
      i.name_1,
      i.name_eng_1,
      i.unit_standard_name,
      b.balance_qty,
      price.sale_price_kip
    FROM balances b
    JOIN ic_inventory i ON i.code = b.ic_code
    LEFT JOIN LATERAL (
      SELECT ipp.sale_price1 AS sale_price_kip
      FROM ic_inventory_price ipp
      WHERE ipp.ic_code = i.code
        AND ipp.currency_code = '02'
        AND COALESCE(ipp.sale_price1, 0) > 0
        AND COALESCE(ipp.status, 1) = 1
      ORDER BY
        COALESCE(ipp.to_date, '2099-12-31'::date) DESC,
        COALESCE(ipp.from_date, '1900-01-01'::date) DESC,
        COALESCE(ipp.create_date_time_now, ipp.create_now) DESC,
        ipp.roworder DESC
      LIMIT 1
    ) price ON true
    WHERE i.name_1 IS NOT NULL
      ${search}
    ORDER BY i.code
    LIMIT 500
  `;

  return NextResponse.json({
    warehouse,
    items: rows.map((r) => ({
      code: r.code,
      nameLo: r.name_1,
      nameEng: r.name_eng_1,
      unitName: r.unit_standard_name,
      balanceQty: r.balance_qty ? Number(r.balance_qty) : 0,
      salePriceKip: r.sale_price_kip ? Number(r.sale_price_kip) : 0,
    })),
  });
}
