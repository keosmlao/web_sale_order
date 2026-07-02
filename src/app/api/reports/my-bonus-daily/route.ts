import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type DailyRow = { day: string; points: string | number };

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

function currentVientianePeriod(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vientiane", year: "numeric", month: "numeric" }).formatToParts(new Date());
  return { year: Number(parts.find((p) => p.type === "year")?.value), month: Number(parts.find((p) => p.type === "month")?.value) };
}

// Per-day bonus points for the logged-in employee this month — same point-map
// derivation as /api/reports/my-bonus-items, but aggregated by doc_date so the
// bonus card can draw a "ຄະແນນ ສະສົມປະຈຳວັນ" trend.
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

  try {
    const rows = await prisma.$queryRaw<DailyRow[]>`
      WITH names AS (
        SELECT fullname_lo AS sn FROM odg_employee WHERE employee_code = ${empCode} AND COALESCE(fullname_lo, '') <> ''
        UNION SELECT salename FROM app_incentive_sale_alias WHERE employee_code = ${empCode}
      ),
      lines AS (
        SELECT
          sd.doc_date, sd.qty, sd.price, sd.item_name, ps.status_code,
          UPPER(COALESCE(sd.item_brand, '')) AS brand,
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
          AND sd.doc_date >= make_date(${year}, ${month}, 1)
          AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
          AND sd.salename IN (SELECT sn FROM names)
      ),
      scored AS (
        SELECT l.doc_date,
               COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.qty AS pts
        FROM lines l
        LEFT JOIN app_incentive_point_map pm
          ON pm.category_code = l.pcat AND pm.brand_code = l.brand
         AND pm.design_token = l.design_token AND pm.size_token = l.size_token
        LEFT JOIN app_incentive_status_multiplier sm ON sm.status_code = l.status_code
      )
      SELECT to_char(doc_date::date, 'YYYY-MM-DD') AS day, SUM(pts) AS points
      FROM scored
      GROUP BY doc_date::date
      ORDER BY doc_date::date
    `;

    return NextResponse.json({
      year,
      month,
      daily: rows.map((r) => ({ day: r.day, points: num(r.points) })),
    });
  } catch (error) {
    console.error("GET /api/reports/my-bonus-daily failed", error);
    return NextResponse.json({ error: "ໂຫລດຄະແນນລາຍວັນບໍ່ສຳເລັດ" }, { status: 503 });
  }
}
