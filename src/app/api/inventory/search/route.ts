import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

// Lightweight ic_inventory search keyed on item code / name / barcode.
// Used by pickers (promotion editor, etc) where the full /api/products
// payload would be overkill — we only need code + display name + unit.
//
// Optional `inStock=1` query param filters out items whose company-wide
// stock balance is zero or negative. We compute that by passing only the
// matched codes into sml_ic_function_stock_balance — running it across the
// full catalog per keystroke would be far too slow.
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
  balance_qty: string | number | null;
  sale_price_kip: string | number | null;
  has_set: boolean | null;
};

type BalanceRow = {
  ic_code: string | null;
  balance_qty: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const qLower = q.toLowerCase();
  const isAirQuery = qLower === "ແອ" || qLower === "air";
  const inStock = request.nextUrl.searchParams.get("inStock") === "1";
  const requestedLimit = Math.min(
    Math.max(
      Number(request.nextUrl.searchParams.get("limit") ?? 50),
      1,
    ),
    100,
  );
  const limit = isAirQuery ? 1000 : requestedLimit;

  const pattern = `%${q}%`;
  const normalizedPattern = isAirQuery ? "%air%" : pattern;
  const rows = q
    ? await prisma.$queryRaw<Row[]>`
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
          price.sale_price_kip,
          EXISTS (
            SELECT 1
            FROM ic_inventory_set_detail d
            WHERE d.ic_set_code = i.code
              AND COALESCE(d.status, 0) <> 1
          ) AS has_set
        FROM ic_inventory i
        LEFT JOIN ic_brand br ON br.code = i.item_brand
        LEFT JOIN ic_category cat ON cat.code = i.item_category
        LEFT JOIN ic_group grp ON grp.code = i.group_main
        LEFT JOIN latest_price price ON price.ic_code = i.code
        WHERE (
          (
            ${isAirQuery}
            AND (i.item_category = '032' OR i.group_main = '12')
            AND EXISTS (
              SELECT 1
              FROM ic_inventory_set_detail d
              WHERE d.ic_set_code = i.code
                AND COALESCE(d.status, 0) <> 1
            )
          )
          OR (
            NOT ${isAirQuery}
            AND (
              i.code ILIKE ${pattern}
              OR COALESCE(i.name_1, '') ILIKE ${pattern}
              OR COALESCE(i.name_eng_1, '') ILIKE ${normalizedPattern}
              OR COALESCE(i.item_brand, '') ILIKE ${pattern}
              OR COALESCE(br.name_1, '') ILIKE ${pattern}
              OR COALESCE(cat.name_1, '') ILIKE ${pattern}
              OR COALESCE(grp.name_1, '') ILIKE ${pattern}
            )
            AND (
              NOT (i.item_category = '032' OR i.group_main = '12')
              OR EXISTS (
                SELECT 1
                FROM ic_inventory_set_detail d
                WHERE d.ic_set_code = i.code
                  AND COALESCE(d.status, 0) <> 1
              )
            )
          )
        )
        ORDER BY
          CASE
            WHEN ${isAirQuery} AND (i.item_category = '032' OR i.group_main = '12') THEN 0
            ELSE 1
          END,
          CASE WHEN i.code ILIKE ${pattern} THEN 0 ELSE 1 END,
          i.code
        LIMIT ${limit}
      `
    : await prisma.$queryRaw<Row[]>`
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
          price.sale_price_kip,
          EXISTS (
            SELECT 1
            FROM ic_inventory_set_detail d
            WHERE d.ic_set_code = i.code
              AND COALESCE(d.status, 0) <> 1
          ) AS has_set
        FROM ic_inventory i
        LEFT JOIN ic_brand br ON br.code = i.item_brand
        LEFT JOIN ic_category cat ON cat.code = i.item_category
        LEFT JOIN ic_group grp ON grp.code = i.group_main
        LEFT JOIN latest_price price ON price.ic_code = i.code
        WHERE (
          NOT (i.item_category = '032' OR i.group_main = '12')
          OR EXISTS (
            SELECT 1
            FROM ic_inventory_set_detail d
            WHERE d.ic_set_code = i.code
              AND COALESCE(d.status, 0) <> 1
          )
        )
        ORDER BY i.name_1
        LIMIT ${limit}
      `;

  // If the caller asked for in-stock-only, intersect with the stock function
  // for just the codes we already matched — keeps the function call bounded
  // even though the underlying scan is expensive.
  let finalRows = rows;
  if (inStock && rows.length > 0) {
    const codeList = rows.map((r) => r.code).join(",");
    const balRows = await prisma.$queryRaw<BalanceRow[]>`
      SELECT ic_code, balance_qty
      FROM public.sml_ic_function_stock_balance(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        ${codeList}
      )
      WHERE COALESCE(balance_qty, 0) > 0
    `;
    const inStockCodes = new Set(
      balRows
        .map((b) => b.ic_code?.trim())
        .filter((c): c is string => !!c),
    );
    finalRows = rows.filter((r) => inStockCodes.has(r.code));
  }

  const visibleRows = finalRows.filter(
    (r) =>
      !(r.item_category?.trim() === "032" || r.group_main?.trim() === "12") ||
      r.has_set === true,
  );

  return NextResponse.json(
    visibleRows.map((r) => {
      const isAirSet =
        (r.item_category?.trim() === "032" || r.group_main?.trim() === "12") &&
        r.has_set === true;
      const unitName = isAirSet ? "ຊຸດ" : r.unit_standard_name?.trim() || null;
      return {
      code: r.code,
      name: r.name_1?.trim() || r.code,
      unit: unitName,
      nameLo: r.name_1?.trim() || r.code,
      nameEng: r.name_eng_1,
      unitName,
      brand: r.item_brand,
      brandName: r.brand_name,
      category: r.item_category,
      categoryName: r.category_name,
      groupMain: r.group_main,
      groupMainName: r.group_main_name,
      hasSet: r.has_set === true,
      status: r.status,
      itemStatus: r.item_status,
      companyBalance: r.balance_qty ? Number(r.balance_qty) : 0,
      salePriceKip: r.sale_price_kip ? Number(r.sale_price_kip) : 0,
      };
    }),
  );
}
