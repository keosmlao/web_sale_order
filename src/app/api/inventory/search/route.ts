import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Lean inventory search — reads only from `ic_inventory` (item catalog +
// cached balance_qty column) and `ic_inventory_price` (latest active sale
// price). No joins to brand/category/group lookup tables, no stock-balance
// function calls. Per-warehouse stock is fetched by a separate
// `/api/inventory/stock-balance` endpoint when the user actually picks a
// product — keeps this list query fast even across very large catalogs.
//
// `sets=1` opts into POS catalog parity with /api/products: AC items
// (item_category='032' OR group_main='12') that have an active set
// composition in ic_inventory_set_detail surface even when balance_qty=0,
// reported as hasSet=true with unitName='ຊຸດ' and stock≥1.
type Row = {
  code: string;
  name_1: string | null;
  name_eng_1: string | null;
  unit_standard_name: string | null;
  item_brand: string | null;
  item_category: string | null;
  group_main: string | null;
  status: number | null;
  item_status: number | null;
  balance_qty: string | number | null;
  sale_price_kip: string | number | null;
  has_set?: boolean | null;
};

function isAirProduct(row: Pick<Row, "item_category" | "group_main">) {
  return row.item_category?.trim() === "032" || row.group_main?.trim() === "12";
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const requestedLimit = Math.min(
    Math.max(
      Number(request.nextUrl.searchParams.get("limit") ?? 50),
      1,
    ),
    100,
  );
  const limit = requestedLimit;
  const pattern = `%${q}%`;
  const includeSets = request.nextUrl.searchParams.get("sets") === "1";

  const rows = includeSets
    ? q
      ? await prisma.$queryRaw<Row[]>`
          WITH set_codes AS (
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
            i.group_main,
            i.status,
            i.item_status,
            i.balance_qty,
            price.sale_price_kip,
            (sc.ic_set_code IS NOT NULL) AS has_set
          FROM ic_inventory i
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
          LEFT JOIN set_codes sc ON sc.ic_set_code = i.code
          WHERE (
              COALESCE(i.balance_qty, 0) > 0
              OR (
                (i.item_category = '032' OR i.group_main = '12')
                AND sc.ic_set_code IS NOT NULL
              )
            )
            AND (
              i.code ILIKE ${pattern}
              OR COALESCE(i.name_1, '') ILIKE ${pattern}
              OR COALESCE(i.name_eng_1, '') ILIKE ${pattern}
              OR COALESCE(i.item_brand, '') ILIKE ${pattern}
            )
          ORDER BY
            CASE WHEN i.code ILIKE ${pattern} THEN 0 ELSE 1 END,
            i.code
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<Row[]>`
          WITH set_codes AS (
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
            i.group_main,
            i.status,
            i.item_status,
            i.balance_qty,
            price.sale_price_kip,
            (sc.ic_set_code IS NOT NULL) AS has_set
          FROM ic_inventory i
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
          LEFT JOIN set_codes sc ON sc.ic_set_code = i.code
          WHERE COALESCE(i.balance_qty, 0) > 0
            OR (
              (i.item_category = '032' OR i.group_main = '12')
              AND sc.ic_set_code IS NOT NULL
            )
          ORDER BY i.name_1
          LIMIT ${limit}
        `
    : q
      ? await prisma.$queryRaw<Row[]>`
          SELECT
            i.code,
            i.name_1,
            i.name_eng_1,
            i.unit_standard_name,
            i.item_brand,
            i.item_category,
            i.group_main,
            i.status,
            i.item_status,
            i.balance_qty,
            price.sale_price_kip
          FROM ic_inventory i
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
          WHERE COALESCE(i.balance_qty, 0) > 0
            AND (
              i.code ILIKE ${pattern}
              OR COALESCE(i.name_1, '') ILIKE ${pattern}
              OR COALESCE(i.name_eng_1, '') ILIKE ${pattern}
              OR COALESCE(i.item_brand, '') ILIKE ${pattern}
            )
          ORDER BY
            CASE WHEN i.code ILIKE ${pattern} THEN 0 ELSE 1 END,
            i.code
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<Row[]>`
          SELECT
            i.code,
            i.name_1,
            i.name_eng_1,
            i.unit_standard_name,
            i.item_brand,
            i.item_category,
            i.group_main,
            i.status,
            i.item_status,
            i.balance_qty,
            price.sale_price_kip
          FROM ic_inventory i
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
          WHERE COALESCE(i.balance_qty, 0) > 0
          ORDER BY i.name_1
          LIMIT ${limit}
        `;

  return NextResponse.json(
    rows.map((r) => {
      const airSet = includeSets && isAirProduct(r) && r.has_set === true;
      const stock = r.balance_qty ? Number(r.balance_qty) : 0;
      const unit = r.unit_standard_name?.trim() || null;
      return {
        code: r.code,
        name: r.name_1?.trim() || r.code,
        unit: airSet ? "ຊຸດ" : unit,
        nameLo: r.name_1?.trim() || r.code,
        nameEng: r.name_eng_1,
        unitName: airSet ? "ຊຸດ" : unit,
        brand: r.item_brand,
        brandName: null,
        category: r.item_category,
        categoryName: null,
        groupMain: r.group_main,
        groupMainName: null,
        hasSet: airSet,
        status: r.status,
        itemStatus: r.item_status,
        companyBalance: airSet ? Math.max(stock, 1) : stock,
        salePriceKip: r.sale_price_kip ? Number(r.sale_price_kip) : 0,
      };
    }),
  );
}
