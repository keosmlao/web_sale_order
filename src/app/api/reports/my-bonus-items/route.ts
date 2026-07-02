import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type ItemRow = {
  item_name: string | null;
  brand: string | null;
  category: string | null;
  qty: string | number;
  points: string | number;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

function currentVientianePeriod(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vientiane", year: "numeric", month: "numeric" }).formatToParts(new Date());
  return { year: Number(parts.find((p) => p.type === "year")?.value), month: Number(parts.find((p) => p.type === "month")?.value) };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee?.employeeCode) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const empCode = employee.employeeCode;

  const current = currentVientianePeriod();
  const url = new URL(request.url);
  const yr = Number(url.searchParams.get("year"));
  const mo = Number(url.searchParams.get("month"));
  const year = Number.isInteger(yr) && yr >= 2020 && yr <= 2100 ? yr : current.year;
  const month = Number.isInteger(mo) && mo >= 1 && mo <= 12 ? mo : current.month;
  // ?scope=today narrows the list to today's sales only (the home bonus card
  // has ສະສົມ / ມື້ນີ້ tabs); default stays the whole month.
  const dateFilter =
    url.searchParams.get("scope") === "today"
      ? Prisma.sql`AND sd.doc_date::date = CURRENT_DATE`
      : Prisma.sql`AND sd.doc_date >= make_date(${year}, ${month}, 1)
          AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'`;

  try {
    // Per-item bonus points for this employee — mirrors the incentive report's
    // point-map derivation, aggregated to one row per product.
    const rows = await prisma.$queryRaw<ItemRow[]>`
      WITH names AS (
        SELECT fullname_lo AS sn FROM odg_employee WHERE employee_code = ${empCode} AND COALESCE(fullname_lo, '') <> ''
        UNION SELECT salename FROM app_incentive_sale_alias WHERE employee_code = ${empCode}
      ),
      lines AS (
        SELECT
          sd.item_name, UPPER(COALESCE(sd.item_brand, '')) AS brand, sd.item_category_name AS category,
          sd.qty, sd.price, sd.item_name AS iname, ps.status_code,
          COALESCE(cat.pointmap_category, 'SDA') AS pcat,
          CASE COALESCE(cat.pointmap_category, 'SDA')
            WHEN 'SDA' THEN COALESCE(cat.sda_subtype, 'OTH')
            WHEN 'Air' THEN CASE WHEN sd.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
            WHEN 'AV' THEN ''
            ELSE COALESCE(dtok.design_token, '')
          END AS design_token,
          CASE
            WHEN COALESCE(cat.pointmap_category, 'SDA') IN ('REF', 'Washer') THEN COALESCE(stok.size_token, '')
            WHEN COALESCE(cat.pointmap_category, 'SDA') = 'AV' AND sd.item_category = '008' THEN COALESCE(stok.size_token, '')
            WHEN COALESCE(cat.pointmap_category, 'SDA') IN ('AV', 'Air') THEN
              CASE WHEN sd.price <= 10000 THEN '<=10000' WHEN sd.price <= 20000 THEN '10001-20000' ELSE '>20000' END
            WHEN COALESCE(cat.pointmap_category, 'SDA') = 'SDA' THEN
              CASE WHEN sd.price <= 500 THEN '<=500' WHEN sd.price <= 1000 THEN '<=1000' WHEN sd.price <= 2000 THEN '<=2000' WHEN sd.price <= 5000 THEN '<=5000' ELSE '>5000' END
            ELSE ''
          END AS size_token
        FROM odg_sale_detail sd
        LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
        LEFT JOIN app_incentive_design_token dtok ON dtok.design_name = sd.design_name
        LEFT JOIN app_incentive_size_token stok ON stok.size_name = sd.size_name
        LEFT JOIN app_incentive_product_status ps ON ps.item_code = sd.item_code
        WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
          ${dateFilter}
          AND sd.salename IN (SELECT sn FROM names)
          -- Service / discount pseudo-items are not sellable products; keep
          -- them out of the got/no-points breakdown entirely.
          AND sd.item_name NOT LIKE 'ບໍລິການ%'
          AND sd.item_name NOT LIKE 'ຄ່າບໍລິການ%'
          AND sd.item_name NOT LIKE 'ສ່ວນຫລຸດ%'
          AND sd.item_name NOT LIKE 'ສ່ວນຫຼຸດ%'
      ),
      scored AS (
        SELECT l.item_name, l.brand, l.category, l.qty,
               COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.qty AS pts
        FROM lines l
        LEFT JOIN app_incentive_point_map pm
          ON pm.category_code = l.pcat AND pm.brand_code = l.brand
         AND pm.design_token = l.design_token AND pm.size_token = l.size_token
        LEFT JOIN app_incentive_status_multiplier sm ON sm.status_code = l.status_code
      )
      SELECT MAX(item_name) AS item_name, MAX(brand) AS brand, MAX(category) AS category,
             SUM(qty) AS qty, SUM(pts) AS points
      FROM scored
      GROUP BY item_name
      -- Zero-point items stay in the list so sellers can SEE which of their
      -- sold products earn points and which don't; zero-qty pseudo lines
      -- (e.g. money-discount rows) are dropped.
      HAVING SUM(qty) > 0
      ORDER BY points DESC, item_name
      LIMIT 150
    `;

    return NextResponse.json({
      year,
      month,
      items: rows.map((r) => ({
        itemName: r.item_name ?? "—",
        brand: r.brand ?? "",
        category: r.category ?? "",
        qty: num(r.qty),
        points: num(r.points),
      })),
    });
  } catch (error) {
    console.error("GET /api/reports/my-bonus-items failed", error);
    return NextResponse.json({ error: "ໂຫລດລາຍການບໍ່ສຳເລັດ" }, { status: 503 });
  }
}
