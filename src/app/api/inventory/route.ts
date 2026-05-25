import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Lean full-catalog dump — reads only from `ic_inventory` (item rows +
// cached `balance_qty` column) and `ic_inventory_price` (latest active
// KIP sale price via LATERAL). No joins to brand/category/group lookup
// tables or to per-warehouse minimum-stock; clients that need those go
// through dedicated endpoints.
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
  balance_qty: string | null;
  sale_price_kip: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<Row[]>`
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
    WHERE i.name_1 IS NOT NULL
      AND COALESCE(i.balance_qty, 0) > 0
    ORDER BY i.code
  `;

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    count: rows.length,
    items: rows.map((r) => ({
      code: r.code,
      nameLo: r.name_1,
      nameEng: r.name_eng_1,
      unitName: r.unit_standard_name,
      brand: r.item_brand,
      brandName: null,
      category: r.item_category,
      categoryName: null,
      groupMain: r.group_main,
      groupMainName: null,
      status: r.status,
      itemStatus: r.item_status,
      companyBalance: r.balance_qty ? Number(r.balance_qty) : 0,
      salesMinimumStock: 0,
      salePriceKip: r.sale_price_kip ? Number(r.sale_price_kip) : 0,
    })),
  });
}
