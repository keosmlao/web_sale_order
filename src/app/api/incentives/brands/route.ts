import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Brand suggestions for the incentive editors, split by reward group so the
// AIR editor offers only air-conditioner brands and CE_SDA offers the rest.
// Derived from what actually sold at the front store this year, categorised via
// app_incentive_category.pointmap_category ('Air' = AC). Users may still type a
// brand that isn't listed yet. `brands` is the flat union (back-compat).
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rows = await prisma.$queryRaw<Array<{ brand: string; is_air: boolean; is_other: boolean }>>`
      SELECT UPPER(TRIM(sd.item_brand)) AS brand,
             bool_or(COALESCE(cat.pointmap_category, '') = 'Air') AS is_air,
             bool_or(COALESCE(cat.pointmap_category, '') <> 'Air') AS is_other
      FROM odg_sale_detail sd
      LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
      WHERE COALESCE(sd.item_brand, '') <> ''
        AND sd.branch_code = '01' AND sd.argroup_main = '101'
        AND sd.doc_date >= date_trunc('year', CURRENT_DATE)
      GROUP BY 1
      ORDER BY 1
    `;
    const air = rows.filter((r) => r.is_air).map((r) => r.brand);
    const other = rows.filter((r) => r.is_other).map((r) => r.brand);
    return NextResponse.json({ air, other, brands: rows.map((r) => r.brand) });
  } catch {
    return NextResponse.json({ air: [], other: [], brands: [] });
  }
}
