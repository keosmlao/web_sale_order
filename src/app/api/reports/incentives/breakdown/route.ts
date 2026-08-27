import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import {
  incentiveBandPrice,
  incentiveMatePrice,
  incentivePointQuantity,
  incentiveWasherSizeBand,
} from "@/lib/incentive-scoring";
import { foldAirSets } from "@/lib/incentive-sets";
import { saleBasis } from "@/lib/sales-basis";
import { saleReportDate, saleReportMonth } from "@/lib/sale-month";

// Per-salesperson bill breakdown for the incentive report: every qualifying
// sale line is returned, zero-point products included, so the detail sales
// total can be reconciled to the employee's report row bill by bill. A split
// air conditioner is one row — the outdoor half is folded into its indoor
// partner, money and all — so a bill reads as the machines it sold.
// Lazy-loaded per employee when a row is expanded, so the main report stays light.
// Reproduces the exact line-level scoring of the main report's `lines`/`sold`
// CTEs (walk-in only, services excluded, newest-effective point rule, status
// multiplier). A zero score is data to display, not a reason to hide the line.

type LineRow = {
  pcat: string | null;
  doc_date: Date | string;
  doc_no: string | null;
  brand: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: string | number | null;
  price: string | number | null;
  unit_points: string | number | null;
  line_points: string | number | null;
  sales_amount: string | number | null;
  point_qty: string | number | null;
  design_token: string | null;
  size_token: string | null;
  configured_points: string | number | null;
  status_code: string | null;
  status_note: string | null;
  status_multiplier: string | number | null;
};

const number = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

// Same label mapping the client chips use, kept here so the bill audit reads
// the same as the workbook's Bonus_Summary columns.
/**
 * Bucket for sales whose category carries no point group. Those are outside
 * the scheme entirely (TV brackets, freezers, spare parts …) — they must not
 * be filed under SDA, which is a real point group whose rules they would then
 * appear to have failed rather than never been subject to.
 */
const OUT_OF_SCHEME = "—";
const CATEGORY_LABELS: Record<string, string> = {
  AV: "AV",
  REF: "ຕູ້ເຢັນ",
  Washer: "ເຄື່ອງຊັກ",
  Air: "ແອ",
  SDA: "SDA",
  [OUT_OF_SCHEME]: "ນອກເງື່ອນໄຂ",
};
const CATEGORY_ORDER = ["Air", "REF", "Washer", "AV", "SDA", OUT_OF_SCHEME];

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const emp = (url.searchParams.get("emp") ?? "").trim();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || !emp) {
    return NextResponse.json({ error: "year, month and emp are required" }, { status: 400 });
  }

  // Role scope: managers/heads may inspect anyone; a regular seller only themselves.
  const role = roleFromEmployee(employee);
  const isManager = role === "manager" || role === "head";
  if (!isManager && emp !== employee.employeeCode) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await prisma.$queryRaw<LineRow[]>`
      WITH lines AS (
        SELECT
          s.doc_date, s.doc_no, s.brand, s.item_code, s.item_name, s.qty, s.point_qty, s.price, s.pcat,
          ps.status_code AS status_code,
          ps.note AS status_note,
          s.sum_amount AS sales_amount,
          CASE s.pcat
            WHEN 'SDA' THEN s.sda_subtype
            WHEN 'Air' THEN CASE WHEN s.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
            WHEN 'AV'  THEN ''
            ELSE COALESCE(dtok.design_token, '')
          END AS design_token,
          CASE
            WHEN s.pcat = 'REF' THEN COALESCE(stok.size_token, '')
            WHEN s.pcat = 'Washer' THEN COALESCE(stok.size_token, ${incentiveWasherSizeBand("s")})
            WHEN s.pcat = 'AV' AND s.item_category = '008' THEN COALESCE(stok.size_token, '')
            WHEN s.pcat IN ('AV', 'Air') THEN
              CASE WHEN s.combo_price <= 10000 THEN '<=10000'
                   WHEN s.combo_price <= 20000 THEN '10001-20000'
                   ELSE '>20000' END
            WHEN s.pcat = 'SDA' THEN
              CASE WHEN s.price <= 500  THEN '<=500'
                   WHEN s.price <= 1000 THEN '<=1000'
                   WHEN s.price <= 2000 THEN '<=2000'
                   WHEN s.price <= 5000 THEN '<=5000'
                   ELSE '>5000' END
            ELSE ''
          END AS size_token
        FROM (
          SELECT
            ${saleReportDate("sd")} AS doc_date, sd.doc_no, sd.qty,
            ${incentivePointQuantity(
              "sd",
              Prisma.sql`cat.pointmap_category`,
              Prisma.sql`${incentiveMatePrice("sd")} IS NOT NULL`,
            )} AS point_qty,
            ${incentiveBandPrice(
              "sd",
              Prisma.sql`cat.pointmap_category`,
            )} AS combo_price,
            sd.sum_amount, sd.price, sd.item_name,
            sd.item_category, sd.design_name, sd.size_name, sd.item_code,
            UPPER(COALESCE(sd.item_brand, '')) AS brand,
            cat.pointmap_category AS pcat,
            COALESCE(cat.sda_subtype, 'OTH') AS sda_subtype
          FROM odg_sale_detail sd
          LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
          LEFT JOIN LATERAL (
            SELECT employee_code FROM (
              SELECT alias.employee_code, 0 AS priority
              FROM app_incentive_sale_alias alias WHERE btrim(alias.salename) = btrim(sd.salename)
              UNION ALL
              SELECT e.employee_code, 1 AS priority
              FROM odg_employee e WHERE btrim(e.fullname_lo) = btrim(sd.salename)
            ) resolved
            ORDER BY priority, employee_code
            LIMIT 1
          ) emp ON true
          WHERE ${saleBasis("sd")}
            AND ${saleReportMonth("sd", year, month)}
            AND COALESCE(cat.is_active, true)
            AND emp.employee_code = ${emp}
        ) s
        LEFT JOIN app_incentive_design_token dtok ON dtok.design_name = s.design_name
        LEFT JOIN app_incentive_size_token stok ON stok.size_name = s.size_name
        LEFT JOIN LATERAL (
          SELECT ps0.status_code, ps0.note
          FROM app_incentive_product_status_rule ps0
          WHERE ps0.item_code = s.item_code
            AND s.doc_date::date BETWEEN ps0.effective_from AND ps0.effective_to
          ORDER BY (ps0.effective_to - ps0.effective_from) ASC,
                   ps0.updated_at DESC
          LIMIT 1
        ) ps ON true
      )
      SELECT
        l.pcat, to_char(l.doc_date::date, 'YYYY-MM-DD') AS doc_date,
        l.doc_no, l.brand, l.item_code, l.item_name, l.qty, l.point_qty, l.price, l.sales_amount,
        l.design_token, l.size_token, l.status_code, l.status_note,
        pm.points AS configured_points, sm.multiplier AS status_multiplier,
        COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) AS unit_points,
        COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.point_qty AS line_points
      FROM lines l
      LEFT JOIN LATERAL (
        SELECT pm0.points
        FROM app_incentive_point_rule pm0
        WHERE pm0.category_code = l.pcat
          AND pm0.brand_code = l.brand
          AND pm0.design_token = l.design_token
          AND l.doc_date::date BETWEEN pm0.effective_from AND pm0.effective_to
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
      ORDER BY l.doc_date, l.doc_no, l.pcat, l.brand, l.item_name
    `;

    // Keep category/brand buckets in the response for totals and PDF use; the
    // on-screen audit flattens their items back into bill order.
    type Item = {
      docDate: string; docNo: string | null; itemName: string | null;
      qty: number; price: number; unitPoints: number; points: number; salesAmount: number;
      noPointReason: string | null;
      pointBasis: string | null;
    };
    type Brand = { brand: string; points: number; salesAmount: number; qty: number; items: Item[] };
    type Cat = { category: string; label: string; points: number; salesAmount: number; qty: number; brands: Map<string, Brand> };
    const byCat = new Map<string, Cat>();
    // One row per SET: the outdoor half of a split air conditioner scores on
    // its indoor partner, so it is folded into it rather than listed as a
    // second line worth half the money and no points. See lib/incentive-sets.
    for (const r of foldAirSets(rows, (partner, half) => {
      partner.sales_amount = number(partner.sales_amount) + number(half.sales_amount);
    })) {
      const cat = r.pcat || OUT_OF_SCHEME;
      let c = byCat.get(cat);
      if (!c) {
        c = { category: cat, label: CATEGORY_LABELS[cat] ?? cat, points: 0, salesAmount: 0, qty: 0, brands: new Map() };
        byCat.set(cat, c);
      }
      const brandName = (r.brand ?? "").trim() || "—";
      let b = c.brands.get(brandName);
      if (!b) {
        b = { brand: brandName, points: 0, salesAmount: 0, qty: 0, items: [] };
        c.brands.set(brandName, b);
      }
      const points = number(r.line_points);
      const sales = number(r.sales_amount);
      const qty = number(r.qty);
      // The dimensions the point rule is looked up by. Note pcat is the
      // point-map category (AV / REF / Air …), not the ERP category name the
      // line is filed under — it is what the rules are written against.
      const dimensions = [
        r.pcat || OUT_OF_SCHEME,
        (r.brand ?? "").trim() || "ບໍ່ມີຍີ່ຫໍ້",
        (r.design_token ?? "").trim() || "—",
        (r.size_token ?? "").trim() || "—",
      ].join(" / ");
      let noPointReason: string | null = null;
      // How the line arrived at its points. 9 a unit can be a 9-point rule or
      // an 18-point rule halved by a product status, and the report cannot be
      // checked without saying which.
      let pointBasis: string | null = null;
      if (points === 0) {
        // Said first: no point group means the category is not part of the
        // scheme at all, and "no matching rule" would read as a gap in the
        // point map rather than a deliberate exclusion.
        if (!r.pcat) {
          noPointReason = "ໝວດສິນຄ້ານີ້ບໍ່ຢູ່ໃນເງື່ອນໄຂການໃຫ້ຄະແນນ";
        } else if (r.pcat === "Air" && number(r.point_qty) === 0 && r.item_name?.match(/\[H\]\s*$/)) {
          noPointReason = "ສ່ວນ [H] ຂອງຊຸດ AIR — ຄະແນນຖືກນັບຢູ່ສ່ວນ [C]";
        } else if (r.status_multiplier != null && number(r.status_multiplier) === 0) {
          noPointReason = r.status_note?.trim()
            ? `ຕັ້ງຄ່າບໍ່ໃຫ້ໂບນັດ: ${r.status_note.trim()}`
            : `ສະຖານະ ${r.status_code ?? "no-bonus"} ບໍ່ໃຫ້ຄະແນນ`;
        } else if (r.configured_points == null) {
          noPointReason = `ບໍ່ມີກົດຄະແນນທີ່ກົງ: ${dimensions}`;
        } else if (number(r.configured_points) === 0) {
          noPointReason = "ກົດ Incentive ຂອງເດືອນນີ້ກຳນົດເປັນ 0 ຄະແນນ";
        } else if (qty === 0) {
          noPointReason = "ຈຳນວນໃນລາຍການເປັນ 0";
        } else {
          noPointReason = "ຜົນຄຳນວນຄະແນນເປັນ 0";
        }
      } else {
        const base = number(r.configured_points);
        const multiplier = r.status_multiplier == null ? 1 : number(r.status_multiplier);
        const note = r.status_note?.trim();
        pointBasis = multiplier === 1
          ? `${dimensions} · ${base} ຄະແນນ/ໜ່ວຍ`
          : `${dimensions} · ${base} × ຕົວຄູນ ${multiplier}${note ? ` (${note})` : ""}`
            + ` = ${number(r.unit_points)}/ໜ່ວຍ`;
      }
      c.points += points; c.salesAmount += sales; c.qty += qty;
      b.points += points; b.salesAmount += sales; b.qty += qty;
      b.items.push({
        docDate: typeof r.doc_date === "string" ? r.doc_date : new Date(r.doc_date).toISOString().slice(0, 10),
        docNo: r.doc_no,
        itemName: r.item_name,
        qty,
        price: number(r.price),
        unitPoints: number(r.unit_points),
        points,
        salesAmount: sales,
        noPointReason,
        pointBasis,
      });
    }

    const categories = [...byCat.values()]
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
      .map((c) => ({
        category: c.category,
        label: c.label,
        points: c.points,
        salesAmount: c.salesAmount,
        qty: c.qty,
        // Brands sorted by points earned (biggest contributor first).
        brands: [...c.brands.values()].sort((x, y) => y.points - x.points),
      }));
    const totalPoints = categories.reduce((s, c) => s + c.points, 0);
    const totalSales = rows.reduce((s, r) => s + number(r.sales_amount), 0);
    const totalBills = new Set(
      rows.map((r) => r.doc_no?.trim()).filter((docNo): docNo is string => !!docNo),
    ).size;

    return NextResponse.json({
      employeeCode: emp,
      year,
      month,
      totalBills,
      totalLines: rows.length,
      totalSales,
      totalPoints,
      categories,
    });
  } catch (error) {
    console.error("GET /api/reports/incentives/breakdown failed", error);
    return NextResponse.json({ error: "breakdown failed" }, { status: 503 });
  }
}
