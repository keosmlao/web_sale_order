import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { incentiveBandPrice, incentivePointQuantity, incentiveWasherSizeBand } from "@/lib/incentive-scoring";
import { saleBasis } from "@/lib/sales-basis";
import { saleReportDate, saleReportMonth } from "@/lib/sale-month";

type ItemRow = {
  item_name: string | null;
  brand: string | null;
  category: string | null;
  qty: string | number;
  points: string | number;
  is_return: boolean;
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
      : Prisma.sql`AND ${saleReportMonth("sd", year, month)}`;

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
          ${saleReportDate("sd")} AS doc_date, sd.item_name, UPPER(COALESCE(sd.item_brand, '')) AS brand, sd.item_category_name AS category,
          sd.qty,
          ${incentivePointQuantity(
            "sd",
            Prisma.sql`COALESCE(cat.pointmap_category, 'SDA')`,
          )} AS point_qty,
          sd.price, sd.item_name AS iname, ps.status_code,
          COALESCE(cat.pointmap_category, 'SDA') AS pcat,
          CASE COALESCE(cat.pointmap_category, 'SDA')
            WHEN 'SDA' THEN COALESCE(cat.sda_subtype, 'OTH')
            WHEN 'Air' THEN CASE WHEN sd.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
            WHEN 'AV' THEN ''
            ELSE COALESCE(dtok.design_token, '')
          END AS design_token,
          CASE
            WHEN COALESCE(cat.pointmap_category, 'SDA') = 'REF' THEN COALESCE(stok.size_token, '')
            WHEN COALESCE(cat.pointmap_category, 'SDA') = 'Washer' THEN COALESCE(stok.size_token, ${incentiveWasherSizeBand("sd")})
            WHEN COALESCE(cat.pointmap_category, 'SDA') = 'AV' AND sd.item_category = '008' THEN COALESCE(stok.size_token, '')
            WHEN COALESCE(cat.pointmap_category, 'SDA') IN ('AV', 'Air') THEN
              CASE
                WHEN ${incentiveBandPrice("sd", Prisma.sql`COALESCE(cat.pointmap_category, 'SDA')`)} <= 10000 THEN '<=10000'
                WHEN ${incentiveBandPrice("sd", Prisma.sql`COALESCE(cat.pointmap_category, 'SDA')`)} <= 20000 THEN '10001-20000'
                ELSE '>20000'
              END
            WHEN COALESCE(cat.pointmap_category, 'SDA') = 'SDA' THEN
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
          ${dateFilter}
          AND sd.salename IN (SELECT sn FROM names)
          -- Discount pseudo-items are not sellable products; keep them out of
          -- the got/no-points breakdown entirely. (Service lines are already
          -- out via saleBasis.)
          AND sd.item_name NOT LIKE 'ສ່ວນຫລຸດ%'
          AND sd.item_name NOT LIKE 'ສ່ວນຫຼຸດ%'
      ),
      scored AS (
        SELECT l.item_name, l.brand, l.category, l.qty,
               COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.point_qty AS pts
        FROM lines l
        -- Monthly point map with carry-forward (newest effect_month <= report month).
        LEFT JOIN LATERAL (
          SELECT pm0.points
          FROM app_incentive_point_rule pm0
          WHERE pm0.category_code = l.pcat AND pm0.brand_code = l.brand
            AND pm0.design_token = l.design_token AND pm0.size_token = l.size_token
            AND l.doc_date::date BETWEEN pm0.effective_from AND pm0.effective_to
          ORDER BY pm0.is_special DESC,
                   (pm0.effective_to - pm0.effective_from) ASC,
                   pm0.updated_at DESC, pm0.id DESC
          LIMIT 1
        ) pm ON true
        LEFT JOIN app_incentive_status_multiplier sm ON sm.status_code = l.status_code
      )
      SELECT MAX(item_name) AS item_name, MAX(brand) AS brand, MAX(category) AS category,
             SUM(qty) AS qty, SUM(pts) AS points, is_return
      FROM (SELECT scored.*, (qty < 0) AS is_return FROM scored) split
      -- Sold and returned lines aggregate SEPARATELY (not netted) so a
      -- credit-note / cancelled-bill deduction shows as its own entry instead
      -- of silently shrinking (or hiding) the sold row.
      GROUP BY item_name, is_return
      -- Zero-point items stay in the list so sellers can SEE which of their
      -- sold products earn points and which don't; zero-qty pseudo lines
      -- (e.g. money-discount rows) are dropped. Return rows always stay.
      HAVING is_return OR SUM(qty) > 0
      -- Deduction rows FIRST so the LIMIT can never truncate them away on a
      -- month with 150+ distinct sold items (the client groups rows itself).
      ORDER BY is_return DESC, points DESC, item_name
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
        isReturn: r.is_return,
      })),
    });
  } catch (error) {
    console.error("GET /api/reports/my-bonus-items failed", error);
    return NextResponse.json({ error: "ໂຫລດລາຍການບໍ່ສຳເລັດ" }, { status: 503 });
  }
}
