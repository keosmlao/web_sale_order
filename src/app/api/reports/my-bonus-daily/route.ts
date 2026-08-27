import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  incentiveBandPrice,
  incentiveMatePrice,
  incentivePointQuantity,
  incentiveWasherSizeBand,
} from "@/lib/incentive-scoring";
import { saleBasis } from "@/lib/sales-basis";
import { saleReportDate, saleReportMonth } from "@/lib/sale-month";

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
          ${saleReportDate("sd")} AS doc_date, sd.qty,
          ${incentivePointQuantity(
            "sd",
            Prisma.sql`cat.pointmap_category`,
            Prisma.sql`${incentiveMatePrice("sd")} IS NOT NULL`,
          )} AS point_qty,
          sd.price, sd.item_name, ps.status_code,
          UPPER(COALESCE(sd.item_brand, '')) AS brand,
          cat.pointmap_category AS pcat,
          CASE cat.pointmap_category
            WHEN 'SDA' THEN COALESCE(cat.sda_subtype, 'OTH')
            WHEN 'Air' THEN CASE WHEN sd.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
            WHEN 'AV' THEN ''
            ELSE COALESCE(dtok.design_token, '')
          END AS design_token,
          CASE
            WHEN cat.pointmap_category = 'REF' THEN COALESCE(stok.size_token, '')
            WHEN cat.pointmap_category = 'Washer' THEN COALESCE(stok.size_token, ${incentiveWasherSizeBand("sd")})
            WHEN cat.pointmap_category = 'AV' AND sd.item_category = '008' THEN COALESCE(stok.size_token, '')
            WHEN cat.pointmap_category IN ('AV', 'Air') THEN
              CASE
                WHEN ${incentiveBandPrice("sd", Prisma.sql`cat.pointmap_category`)} <= 10000 THEN '<=10000'
                WHEN ${incentiveBandPrice("sd", Prisma.sql`cat.pointmap_category`)} <= 20000 THEN '10001-20000'
                ELSE '>20000'
              END
            WHEN cat.pointmap_category = 'SDA' THEN
              CASE WHEN sd.price <= 500 THEN '<=500' WHEN sd.price <= 1000 THEN '<=1000' WHEN sd.price <= 2000 THEN '<=2000' WHEN sd.price <= 5000 THEN '<=5000' ELSE '>5000' END
            ELSE ''
          END AS size_token
        FROM odg_sale_detail sd
        LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
        LEFT JOIN app_incentive_design_token dtok ON dtok.design_name = sd.design_name
        LEFT JOIN app_incentive_size_token stok ON stok.size_name = sd.size_name
        LEFT JOIN LATERAL (
          SELECT ps0.status_code
          FROM app_incentive_product_status_rule ps0
          WHERE ps0.item_code = sd.item_code
            AND ${saleReportDate("sd")}::date BETWEEN ps0.effective_from AND ps0.effective_to
          ORDER BY (ps0.effective_to - ps0.effective_from) ASC,
                   ps0.updated_at DESC
          LIMIT 1
        ) ps ON true
        WHERE ${saleBasis("sd")}
          AND ${saleReportMonth("sd", year, month)}
          AND sd.salename IN (SELECT sn FROM names)
      ),
      scored AS (
        SELECT l.doc_date,
               COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.point_qty AS pts
        FROM lines l
        -- Monthly point map with carry-forward (newest effect_month <= report month).
        LEFT JOIN LATERAL (
          SELECT pm0.points
          FROM app_incentive_point_rule pm0
          WHERE pm0.category_code = l.pcat AND pm0.brand_code = l.brand
            AND pm0.design_token = l.design_token AND l.doc_date::date BETWEEN pm0.effective_from AND pm0.effective_to
            -- A "<=" band is a ceiling, not a bracket: the rule written at
            -- <=5000 covers everything up to 5,000 that no tighter ceiling
            -- already covers. The exact band still wins, so a deliberate 0
            -- beats falling up; bands that are not ceilings never fall up.
            AND (
              pm0.size_token = l.size_token
              OR (
                l.size_token ~ '^<=' AND pm0.size_token ~ '^<='
                AND (substring(pm0.size_token from '([0-9.]+)'))::numeric
                    >= (substring(l.size_token from '([0-9.]+)'))::numeric
              )
            )
          ORDER BY (pm0.size_token = l.size_token) DESC,
                   CASE WHEN pm0.size_token ~ '^<=' THEN (substring(pm0.size_token from '([0-9.]+)'))::numeric ELSE 1e18 END ASC,
                   pm0.is_special DESC,
                   (pm0.effective_to - pm0.effective_from) ASC,
                   pm0.updated_at DESC, pm0.id DESC
          LIMIT 1
        ) pm ON true
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
