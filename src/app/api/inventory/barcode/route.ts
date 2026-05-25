import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/inventory/barcode?code=4901234567890
//
// Look up an ic_inventory row by barcode (stored in ic_inventory_barcode).
// Falls back to a direct ic_inventory.code match so the UI can use this as a
// "smart scan" — works whether the cashier scanned a real EAN/UPC or a
// barcode tag printed with the item code itself.
//
// 200 → { found: true,  item: { code, name, ... } }
// 200 → { found: false } (no match — UI decides what to do)
// 401 → unauth

type ItemRow = {
  code: string;
  name_1: string | null;
  unit_standard_name: string | null;
  sale_price_kip: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  if (!code) {
    return NextResponse.json({ found: false });
  }

  // Resolve barcode → ic_code (preferred), then fall back to direct item code.
  const rows = await prisma.$queryRaw<ItemRow[]>`
    WITH resolved AS (
      SELECT ic_code AS code FROM ic_inventory_barcode WHERE barcode = ${code}
      UNION ALL
      SELECT code FROM ic_inventory WHERE code = ${code}
    )
    SELECT
      i.code,
      i.name_1,
      i.unit_standard_name,
      (
        SELECT sale_price1
        FROM ic_inventory_price
        WHERE ic_code = i.code
          AND currency_code = '02'
          AND COALESCE(sale_price1, 0) > 0
          AND COALESCE(status, 1) = 1
        ORDER BY
          COALESCE(to_date,   '2099-12-31'::date) DESC,
          COALESCE(from_date, '1900-01-01'::date) DESC,
          COALESCE(create_date_time_now, create_now) DESC,
          roworder DESC
        LIMIT 1
      ) AS sale_price_kip
    FROM ic_inventory i
    WHERE i.code = (SELECT code FROM resolved LIMIT 1)
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({
    found: true,
    item: {
      code: row.code,
      name: row.name_1?.trim() || row.code,
      unitName: row.unit_standard_name?.trim() || null,
      salePriceKip: row.sale_price_kip ? Number(row.sale_price_kip) : 0,
    },
  });
}
