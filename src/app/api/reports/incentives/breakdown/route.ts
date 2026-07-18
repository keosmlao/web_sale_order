import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Per-salesperson point breakdown for the incentive report's tree view:
// ພະນັກງານ → ໝວດ (AV/REF/Washer/Air/SDA) → ສິນຄ້າ that earned points.
// Lazy-loaded per employee when a row is expanded, so the main report stays light.
// Reproduces the exact line-level scoring of the main report's `lines`/`sold` CTEs
// (walk-in only, services excluded, newest-effective point rule, status multiplier).

type LineRow = {
  pcat: string;
  doc_date: Date | string;
  doc_no: string | null;
  brand: string | null;
  item_name: string | null;
  qty: string | number | null;
  price: string | number | null;
  unit_points: string | number | null;
  line_points: string | number | null;
  sales_amount: string | number | null;
};

const number = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

// Same label mapping the client chips use, kept here so the tree groups read the
// same as the workbook's Bonus_Summary columns.
const CATEGORY_LABELS: Record<string, string> = {
  AV: "AV",
  REF: "ຕູ້ເຢັນ",
  Washer: "ເຄື່ອງຊັກ",
  Air: "ແອ",
  SDA: "SDA",
};
const CATEGORY_ORDER = ["Air", "REF", "Washer", "AV", "SDA"];

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
          s.doc_date, s.doc_no, s.brand, s.item_name, s.qty, s.price, s.pcat,
          ps.status_code AS status_code,
          s.sum_amount AS sales_amount,
          CASE s.pcat
            WHEN 'SDA' THEN s.sda_subtype
            WHEN 'Air' THEN CASE WHEN s.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
            WHEN 'AV'  THEN ''
            ELSE COALESCE(dtok.design_token, '')
          END AS design_token,
          CASE
            WHEN s.pcat IN ('REF', 'Washer') THEN COALESCE(stok.size_token, '')
            WHEN s.pcat = 'AV' AND s.item_category = '008' THEN COALESCE(stok.size_token, '')
            WHEN s.pcat IN ('AV', 'Air') THEN
              CASE WHEN s.price <= 10000 THEN '<=10000'
                   WHEN s.price <= 20000 THEN '10001-20000'
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
            sd.doc_date, sd.doc_no, sd.qty, sd.sum_amount, sd.price, sd.item_name,
            sd.item_category, sd.design_name, sd.size_name, sd.item_code,
            UPPER(COALESCE(sd.item_brand, '')) AS brand,
            COALESCE(cat.pointmap_category, 'SDA') AS pcat,
            COALESCE(cat.sda_subtype, 'OTH') AS sda_subtype
          FROM odg_sale_detail sd
          LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
          LEFT JOIN LATERAL (
            SELECT employee_code FROM (
              SELECT alias.employee_code, 0 AS priority
              FROM app_incentive_sale_alias alias WHERE alias.salename = sd.salename
              UNION ALL
              SELECT e.employee_code, 1 AS priority
              FROM odg_employee e WHERE e.fullname_lo = sd.salename
            ) resolved
            ORDER BY priority, employee_code
            LIMIT 1
          ) emp ON true
          WHERE sd.branch_code = '01'
            AND sd.argroup_main = '101'
            AND sd.item_code NOT LIKE '97%'
            AND sd.doc_date >= make_date(${year}, ${month}, 1)
            AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
            AND COALESCE(cat.is_active, true)
            AND emp.employee_code = ${emp}
        ) s
        LEFT JOIN app_incentive_design_token dtok ON dtok.design_name = s.design_name
        LEFT JOIN app_incentive_size_token stok ON stok.size_name = s.size_name
        LEFT JOIN LATERAL (
          SELECT ps0.status_code
          FROM app_incentive_product_status_rule ps0
          WHERE ps0.item_code = s.item_code
            AND s.doc_date::date BETWEEN ps0.effective_from AND ps0.effective_to
          ORDER BY (ps0.effective_to - ps0.effective_from) ASC,
                   ps0.updated_at DESC
          LIMIT 1
        ) ps ON true
      )
      SELECT
        l.pcat, l.doc_date, l.doc_no, l.brand, l.item_name, l.qty, l.price, l.sales_amount,
        COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) AS unit_points,
        COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.qty AS line_points
      FROM lines l
      LEFT JOIN LATERAL (
        SELECT pm0.points
        FROM app_incentive_point_rule pm0
        WHERE pm0.category_code = l.pcat
          AND pm0.brand_code = l.brand
          AND pm0.design_token = l.design_token
          AND pm0.size_token = l.size_token
          AND l.doc_date::date BETWEEN pm0.effective_from AND pm0.effective_to
        ORDER BY pm0.is_special DESC,
                 (pm0.effective_to - pm0.effective_from) ASC,
                 pm0.updated_at DESC, pm0.id DESC
        LIMIT 1
      ) pm ON true
      LEFT JOIN app_incentive_status_multiplier sm ON sm.status_code = l.status_code
      WHERE COALESCE(pm.points, 0) <> 0
      ORDER BY l.pcat, l.doc_date, l.doc_no
    `;

    // Group into the tree: category → brand → items.
    type Item = {
      docDate: string; docNo: string | null; itemName: string | null;
      qty: number; price: number; unitPoints: number; points: number; salesAmount: number;
    };
    type Brand = { brand: string; points: number; salesAmount: number; qty: number; items: Item[] };
    type Cat = { category: string; label: string; points: number; salesAmount: number; qty: number; brands: Map<string, Brand> };
    const byCat = new Map<string, Cat>();
    for (const r of rows) {
      const cat = r.pcat || "SDA";
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

    return NextResponse.json({ employeeCode: emp, year, month, totalPoints, categories });
  } catch (error) {
    console.error("GET /api/reports/incentives/breakdown failed", error);
    return NextResponse.json({ error: "breakdown failed" }, { status: 503 });
  }
}
