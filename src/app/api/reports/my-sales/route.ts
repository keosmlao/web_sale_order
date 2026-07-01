import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type Totals = { sales: string | number | null; qty: string | number | null; target: string | number | null };
type DailyRow = { d: Date; sales: string | number; qty: string | number };
type CategoryRow = { name: string | null; sales: string | number; qty: string | number };

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

  try {
    // Every salename that belongs to this employee: their roster name plus any alias.
    const [totalsRows, daily, categories, emp, rankRows] = await Promise.all([
      prisma.$queryRaw<Totals[]>`
        WITH names AS (
          SELECT fullname_lo AS sn FROM odg_employee WHERE employee_code = ${empCode} AND COALESCE(fullname_lo, '') <> ''
          UNION SELECT salename FROM app_incentive_sale_alias WHERE employee_code = ${empCode}
        )
        SELECT
          (SELECT COALESCE(SUM(sd.sum_amount), 0) FROM odg_sale_detail sd
             WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
               AND sd.doc_date >= make_date(${year}, ${month}, 1)
               AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
               AND sd.salename IN (SELECT sn FROM names)) AS sales,
          (SELECT COALESCE(SUM(sd.qty), 0) FROM odg_sale_detail sd
             WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
               AND sd.doc_date >= make_date(${year}, ${month}, 1)
               AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
               AND sd.salename IN (SELECT sn FROM names)) AS qty,
          (SELECT COALESCE(SUM(target), 0) FROM odg_retail_target_employee
             WHERE emp_code = ${empCode} AND year = ${year.toString()}
               AND LPAD(month, 2, '0') = LPAD(${month.toString()}, 2, '0')) AS target
      `,
      prisma.$queryRaw<DailyRow[]>`
        WITH names AS (
          SELECT fullname_lo AS sn FROM odg_employee WHERE employee_code = ${empCode} AND COALESCE(fullname_lo, '') <> ''
          UNION SELECT salename FROM app_incentive_sale_alias WHERE employee_code = ${empCode}
        )
        SELECT sd.doc_date AS d, SUM(sd.sum_amount) AS sales, SUM(sd.qty) AS qty
        FROM odg_sale_detail sd
        WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
          AND sd.doc_date >= make_date(${year}, ${month}, 1)
          AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
          AND sd.salename IN (SELECT sn FROM names)
        GROUP BY sd.doc_date ORDER BY sd.doc_date
      `,
      prisma.$queryRaw<CategoryRow[]>`
        WITH names AS (
          SELECT fullname_lo AS sn FROM odg_employee WHERE employee_code = ${empCode} AND COALESCE(fullname_lo, '') <> ''
          UNION SELECT salename FROM app_incentive_sale_alias WHERE employee_code = ${empCode}
        )
        SELECT COALESCE(NULLIF(sd.item_category_name, ''), 'ອື່ນໆ') AS name,
               SUM(sd.sum_amount) AS sales, SUM(sd.qty) AS qty
        FROM odg_sale_detail sd
        WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
          AND sd.doc_date >= make_date(${year}, ${month}, 1)
          AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
          AND sd.salename IN (SELECT sn FROM names)
        GROUP BY 1 ORDER BY sales DESC LIMIT 15
      `,
      prisma.$queryRaw<Array<{ display_name: string | null }>>`
        SELECT COALESCE(NULLIF(fullname_lo, ''), NULLIF(nickname, ''), ${empCode}) AS display_name
        FROM odg_employee WHERE employee_code = ${empCode} LIMIT 1
      `,
      // Rank among the roster (everyone with a target this month) by walk-in sales.
      prisma.$queryRaw<Array<{ rnk: number; team: number }>>`
        WITH sold AS (
          SELECT emp.employee_code, SUM(sd.sum_amount) AS sales
          FROM odg_sale_detail sd
          LEFT JOIN LATERAL (
            SELECT employee_code FROM (
              SELECT a.employee_code, 0 AS pr FROM app_incentive_sale_alias a WHERE a.salename = sd.salename
              UNION ALL SELECT e.employee_code, 1 FROM odg_employee e WHERE e.fullname_lo = sd.salename
            ) q ORDER BY pr, employee_code LIMIT 1
          ) emp ON true
          WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
            AND sd.doc_date >= make_date(${year}, ${month}, 1)
            AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
            AND emp.employee_code IS NOT NULL
          GROUP BY emp.employee_code
        ),
        roster AS (
          SELECT DISTINCT emp_code FROM odg_retail_target_employee
          WHERE year = ${year.toString()} AND LPAD(month, 2, '0') = LPAD(${month.toString()}, 2, '0')
        ),
        ranked AS (
          SELECT r.emp_code,
                 RANK() OVER (ORDER BY COALESCE(s.sales, 0) DESC) AS rnk,
                 COUNT(*) OVER () AS team
          FROM roster r LEFT JOIN sold s ON s.employee_code = r.emp_code
        )
        SELECT rnk, team FROM ranked WHERE emp_code = ${empCode}
      `,
    ]);

    const t = totalsRows[0] ?? { sales: 0, qty: 0, target: 0 };
    const sales = num(t.sales);
    const target = num(t.target);
    return NextResponse.json({
      year,
      month,
      displayName: emp[0]?.display_name ?? empCode,
      employeeCode: empCode,
      totalSales: sales,
      totalQty: num(t.qty),
      target,
      achievementPct: target > 0 ? sales / target : 0,
      rank: Number(rankRows[0]?.rnk ?? 0),
      teamSize: Number(rankRows[0]?.team ?? 0),
      daily: daily.map((r) => ({ date: r.d.toISOString().slice(0, 10), sales: num(r.sales), qty: num(r.qty) })),
      categories: categories.map((r) => ({ name: r.name ?? "ອື່ນໆ", sales: num(r.sales), qty: num(r.qty) })),
    });
  } catch (error) {
    console.error("GET /api/reports/my-sales failed", error);
    return NextResponse.json({ error: "ໂຫລດ dashboard ບໍ່ສຳເລັດ" }, { status: 503 });
  }
}
