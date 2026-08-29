import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

// One item, everything the stock drawer shows: the catalog row with its
// group names spelled out, live balance per warehouse, the KIP price
// table, and the barcodes.

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { code: raw } = await context.params;
  const code = decodeURIComponent(raw).trim();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const [infoRows, whRows, priceRows, barcodeRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        code: string;
        name_1: string | null;
        name_eng_1: string | null;
        unit_standard_name: string | null;
        item_brand: string | null;
        balance_qty: string | number | null;
        group_main_name: string | null;
        group_sub_name: string | null;
        group_sub2_name: string | null;
        category_name: string | null;
        pattern_name: string | null;
      }>
    >`
      SELECT
        i.code, i.name_1, i.name_eng_1, i.unit_standard_name, i.item_brand,
        i.balance_qty,
        g.name_1  AS group_main_name,
        gs.name_1 AS group_sub_name,
        g2.name_1 AS group_sub2_name,
        c.name_1  AS category_name,
        pt.name_1 AS pattern_name
      FROM ic_inventory i
      LEFT JOIN ic_group g       ON g.code  = i.group_main
      LEFT JOIN ic_group_sub gs  ON gs.code = i.group_sub
      LEFT JOIN ic_group_sub2 g2 ON g2.code = i.group_sub2
      LEFT JOIN ic_category c    ON c.code  = i.item_category
      LEFT JOIN ic_pattern pt    ON pt.code = i.item_pattern
      WHERE i.code = ${code}
      LIMIT 1
    `,
    prisma.$queryRaw<
      Array<{ wh_code: string; wh_name: string | null; balance_qty: string | number }>
    >`
      SELECT b.warehouse AS wh_code, w.name_1 AS wh_name,
             SUM(b.balance_qty) AS balance_qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date, ${code}, ''
      ) b
      LEFT JOIN ic_warehouse w ON w.code = b.warehouse
      WHERE COALESCE(b.warehouse, '') <> ''
      GROUP BY b.warehouse, w.name_1
      HAVING SUM(b.balance_qty) <> 0
      ORDER BY b.warehouse
    `.catch(() => []),
    prisma.$queryRaw<
      Array<{
        unit_code: string | null;
        from_qty: string | number | null;
        to_qty: string | number | null;
        from_date: Date | null;
        to_date: Date | null;
        sale_price1: string | number | null;
      }>
    >`
      -- DISTINCT on the condition fields: SML holds literal duplicate
      -- rows (same unit, window, tier and price; different roworder), and
      -- two identical lines read as a difference that is not there.
      SELECT DISTINCT unit_code, from_qty, to_qty, from_date, to_date, sale_price1
      FROM ic_inventory_price
      WHERE ic_code = ${code}
        AND currency_code = '02'
        AND COALESCE(status, 1) = 1
        AND COALESCE(sale_price1, 0) > 0
        -- Only the window that covers today — an expired price or one not
        -- yet in force is not a price the counter can charge.
        AND COALESCE(from_date, '1900-01-01'::date) <= CURRENT_DATE
        AND COALESCE(to_date, '2099-12-31'::date) >= CURRENT_DATE
      -- Plain columns only: SELECT DISTINCT refuses an ORDER BY
      -- expression that is not in the select list. NULL to_date means
      -- open-ended, so it sorts first.
      ORDER BY to_date DESC NULLS FIRST, from_qty
      LIMIT 20
    `,
    prisma.$queryRaw<Array<{ barcode: string | null; unit_code: string | null }>>`
      SELECT barcode, unit_code FROM ic_inventory_barcode
      WHERE ic_code = ${code} AND COALESCE(barcode,'') <> ''
      ORDER BY roworder
      LIMIT 20
    `.catch(() => []),
  ]);

  const info = infoRows[0];
  if (!info) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    code: info.code,
    nameLo: info.name_1,
    nameEng: info.name_eng_1,
    unitName: info.unit_standard_name,
    brand: info.item_brand,
    companyBalance: info.balance_qty ? Number(info.balance_qty) : 0,
    groupMain: info.group_main_name,
    groupSub: info.group_sub_name,
    groupSub2: info.group_sub2_name,
    category: info.category_name,
    pattern: info.pattern_name,
    warehouses: whRows.map((w) => ({
      code: w.wh_code,
      name: w.wh_name ?? w.wh_code,
      qty: Number(w.balance_qty),
    })),
    prices: priceRows.map((p) => ({
      unit: p.unit_code,
      fromQty: p.from_qty ? Number(p.from_qty) : 0,
      toQty: p.to_qty ? Number(p.to_qty) : 0,
      fromDate: p.from_date ? p.from_date.toISOString().slice(0, 10) : null,
      toDate: p.to_date ? p.to_date.toISOString().slice(0, 10) : null,
      priceKip: p.sale_price1 ? Number(p.sale_price1) : 0,
    })),
    barcodes: barcodeRows.map((b) => ({
      barcode: b.barcode,
      unit: b.unit_code,
    })),
  });
}
