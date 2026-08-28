import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { targetSalesScope } from "@/lib/sales-scope";
import { saleReportDate, saleReportCurrentMonth } from "@/lib/sale-month";
import { saleBasis } from "@/lib/sales-basis";

// The personal home dashboard, in one place.
//
// The web home page and the Android app both show "my sales today, this
// month, against my target, where I rank". They used to compute it
// separately — the app off SOK order totals in kip, the page off
// odg_sale_detail in baht — so the same person saw two different numbers
// for the same day and had no way to tell which was the real one.
//
// Both now read this. Not "the same SQL copied twice": the same function.
// A change to what counts as a sale lands on both surfaces or on neither.
//
// Everything here is REALISED sales from odg_sale_detail — the sale sheet
// the incentive and my-sales reports settle against — in ບາດ, scoped to
// one person by their roster name plus any aliases.

// ── the shape both surfaces render ──────────────────────────────────────

export type HomeDashboard = {
  /** Realised sales, today and yesterday. */
  today: { sales: number; qty: number; bills: number };
  yesterday: { sales: number; qty: number; bills: number };
  /** Month to date, on the credited month (a bill moved back a month
   *  drops out here and lands in that month's figures). */
  month: { sales: number; bills: number };
  /** This month against this person's target from the roster. */
  target: { sales: number; qty: number; target: number; pct: number };
  /** Where this person stands among their own department. */
  rank: {
    teamSize: number;
    day: { rank: number; sales: number };
    week: { rank: number; sales: number };
    month: { rank: number; sales: number };
  };
  /** The last seven days, one entry per day, oldest first. Days with no
   *  sales are present with zeroes so a chart can plot a flat run. */
  daily: Array<{ day: string; sales: number; bills: number }>;
  /** Month to date, broken down. */
  categories: Array<{ category: string; amount: number; qty: number }>;
  topItems: Array<{ name: string; amount: number; qty: number }>;
  /** This person's most recent settled bills. */
  recentBills: Array<{ day: string; docNo: string; amount: number; items: number }>;
  /** Front-store bills still waiting on the cashier — not personal, but
   *  it is what a seller checks before going home. */
  pending: { count: number; amount: number };
};

type SaleDayRow = {
  today_sales: string | number | null;
  yesterday_sales: string | number | null;
  today_qty: string | number | null;
  yesterday_qty: string | number | null;
  today_bills: bigint;
  yesterday_bills: bigint;
};
type SaleMonthRow = { month_sales: string | number | null; month_bills: bigint | number | null };
type TargetRow = {
  sales: string | number | null;
  qty: string | number | null;
  target: string | number | null;
};
type RankRow = {
  day_rnk: number | string | null;
  week_rnk: number | string | null;
  month_rnk: number | string | null;
  team: number | string | null;
  day_sales: number | string | null;
  week_sales: number | string | null;
  month_sales: number | string | null;
};
type DailyRow = { day: Date; total: string | number | null; orders: bigint };
type CategoryRow = { category: string | null; amount: string | number | null; qty: string | number | null };
type TopItemRow = { item_name: string | null; amount: string | number | null; qty: string | number | null };
type RecentBillRow = { day: string; doc_no: string; amount: string | number | null; items: bigint };
type PendingRow = { count: bigint; amount: string | number | null };

const num = (v: string | number | bigint | null | undefined) => Number(v ?? 0);

// "ໜ້າຮ້ານ ຂົວຫຼວງ" — the front-shop sales departments. The cashier queue
// figure is scoped to these so it reflects the storefront's own till.
const KHUA_LUANG_DEPTS = ["2012", "2022", "2032", "2042", "2062"] as const;

/**
 * One person's sales identity. A seller's rows in odg_sale_detail are
 * matched on the name printed on the bill, which is their roster name —
 * plus any aliases recorded for them, because the sheet has been written
 * by hand for years and the same person appears under more than one
 * spelling.
 */
export function meNamesCte(employeeCode: string) {
  return Prisma.sql`
    WITH names AS (
      SELECT fullname_lo AS salename FROM odg_employee
        WHERE employee_code = ${employeeCode} AND COALESCE(fullname_lo, '') <> ''
      UNION
      SELECT salename FROM app_incentive_sale_alias
        WHERE employee_code = ${employeeCode}
    )`;
}

export const meNamesFilter = Prisma.sql`AND salename IN (SELECT salename FROM names)`;

/**
 * Whose sales the figures describe.
 *
 * `me` — one seller's own. `team` — the whole front-store floor, which is
 * what a head or a manager is accountable for and what the web home page
 * has always shown them. Rank stays personal in both: a manager still
 * wants to know where they sit among their own department.
 *
 * The caller decides from the role, and both surfaces decide the same way,
 * or the person who most often has the web and the app open side by side
 * is the one who sees two different numbers.
 */
export type HomeScope = "me" | "team";

export async function getHomeDashboard(
  employeeCode: string,
  departmentCode: string,
  scope: HomeScope = "me",
): Promise<HomeDashboard> {
  const team = scope === "team";
  const names = team ? Prisma.empty : meNamesCte(employeeCode);
  const mine = team ? Prisma.empty : meNamesFilter;
  const deptIn = Prisma.sql`department_code IN (${Prisma.join([...KHUA_LUANG_DEPTS])})`;

  const [
    saleDayRows,
    saleMonthRows,
    targetRows,
    rankRows,
    dailyRows,
    categoryRows,
    topItemRows,
    recentBillRows,
    pendingRows,
  ] = await Promise.all([
    prisma.$queryRaw<SaleDayRow[]>`
      ${names}
      SELECT
        COALESCE(SUM(sum_amount) FILTER (WHERE doc_date::date = CURRENT_DATE), 0) AS today_sales,
        COALESCE(SUM(sum_amount) FILTER (WHERE doc_date::date = CURRENT_DATE - 1), 0) AS yesterday_sales,
        COALESCE(SUM(qty) FILTER (WHERE doc_date::date = CURRENT_DATE), 0) AS today_qty,
        COALESCE(SUM(qty) FILTER (WHERE doc_date::date = CURRENT_DATE - 1), 0) AS yesterday_qty,
        COUNT(DISTINCT doc_no) FILTER (WHERE doc_date::date = CURRENT_DATE)::bigint AS today_bills,
        COUNT(DISTINCT doc_no) FILTER (WHERE doc_date::date = CURRENT_DATE - 1)::bigint AS yesterday_bills
      FROM odg_sale_detail
      WHERE ${saleBasis()}
        ${targetSalesScope("odg_sale_detail")}
        AND doc_date >= CURRENT_DATE - 1
        ${mine}
    `,
    prisma.$queryRaw<SaleMonthRow[]>`
      ${names}
      SELECT
        COALESCE(SUM(sum_amount), 0) AS month_sales,
        COUNT(DISTINCT doc_no)::bigint AS month_bills
      FROM odg_sale_detail
      WHERE ${saleBasis()}
        ${targetSalesScope("odg_sale_detail")}
        AND ${saleReportCurrentMonth("odg_sale_detail")}
        ${mine}
    `,
    team
      ? // Supervisor view: the whole storefront, every seller in scope —
        // not only the ones given a target. Matches the department reward
        // card and /api/reports/my-sales.
        prisma.$queryRaw<TargetRow[]>`
          SELECT
            COALESCE((SELECT SUM(detail.sum_amount) FROM odg_sale_detail detail
              WHERE ${saleBasis("detail")}
                ${targetSalesScope("detail")}
                AND ${saleReportCurrentMonth("detail")}), 0) AS sales,
            COALESCE((SELECT SUM(detail.qty) FROM odg_sale_detail detail
              WHERE ${saleBasis("detail")}
                ${targetSalesScope("detail")}
                AND ${saleReportCurrentMonth("detail")}), 0) AS qty,
            COALESCE((SELECT SUM(employee_target.target) FROM odg_retail_target_employee employee_target
              WHERE employee_target.year = to_char(CURRENT_DATE, 'YYYY')
                AND LPAD(employee_target.month, 2, '0') = to_char(CURRENT_DATE, 'MM')), 0) AS target
        `
      : prisma.$queryRaw<TargetRow[]>`
          ${names}
          SELECT
            COALESCE((SELECT SUM(detail.sum_amount) FROM odg_sale_detail detail
              WHERE ${saleBasis("detail")}
                ${targetSalesScope("detail")}
                AND ${saleReportCurrentMonth("detail")}
                AND detail.salename IN (SELECT salename FROM names)), 0) AS sales,
            COALESCE((SELECT SUM(detail.qty) FROM odg_sale_detail detail
              WHERE ${saleBasis("detail")}
                ${targetSalesScope("detail")}
                AND ${saleReportCurrentMonth("detail")}
                AND detail.salename IN (SELECT salename FROM names)), 0) AS qty,
            COALESCE((SELECT SUM(target) FROM odg_retail_target_employee
              WHERE emp_code = ${employeeCode}
                AND year = to_char(CURRENT_DATE, 'YYYY')
                AND LPAD(month, 2, '0') = to_char(CURRENT_DATE, 'MM')), 0) AS target
        `,
    // Rank within this person's own department.
    prisma.$queryRaw<RankRow[]>`
      WITH sold AS (
        SELECT emp.employee_code, emp.department_code,
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE sd.doc_date::date = CURRENT_DATE), 0) AS day_sales,
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE sd.doc_date >= date_trunc('week', CURRENT_DATE)), 0) AS week_sales,
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE ${saleReportDate("sd")} >= date_trunc('month', CURRENT_DATE)), 0) AS month_sales
        FROM odg_sale_detail sd
        LEFT JOIN LATERAL (
          SELECT employee_code FROM (
            SELECT a.employee_code, 0 AS pr FROM app_incentive_sale_alias a WHERE a.salename = sd.salename
            UNION ALL SELECT e.employee_code, 1 FROM odg_employee e WHERE e.fullname_lo = sd.salename
          ) q ORDER BY pr, employee_code LIMIT 1
        ) resolved ON true
        LEFT JOIN odg_employee emp ON emp.employee_code = resolved.employee_code
        WHERE ${saleBasis("sd")}
          -- One month of slack on the scan window so a bill credited into
          -- this month from the previous one is still reachable; the
          -- FILTERs above decide what actually counts.
          AND sd.doc_date >= LEAST(date_trunc('month', CURRENT_DATE), date_trunc('week', CURRENT_DATE)) - INTERVAL '1 month'
          AND resolved.employee_code IS NOT NULL
        GROUP BY emp.employee_code, emp.department_code
      ),
      dept AS (SELECT * FROM sold WHERE department_code = ${departmentCode}),
      ranked AS (
        SELECT employee_code, day_sales, week_sales, month_sales,
          RANK() OVER (ORDER BY day_sales DESC) AS day_rnk,
          RANK() OVER (ORDER BY week_sales DESC) AS week_rnk,
          RANK() OVER (ORDER BY month_sales DESC) AS month_rnk,
          COUNT(*) OVER () AS team
        FROM dept
      )
      SELECT day_rnk, week_rnk, month_rnk, team, day_sales, week_sales, month_sales
      FROM ranked WHERE employee_code = ${employeeCode}
    `,
    prisma.$queryRaw<DailyRow[]>`
      ${names}
      SELECT
        doc_date::date AS day,
        COALESCE(SUM(sum_amount), 0) AS total,
        COUNT(DISTINCT doc_no)::bigint AS orders
      FROM odg_sale_detail
      WHERE ${saleBasis()}
        ${targetSalesScope("odg_sale_detail")}
        -- sargable (no ::date cast) so the front-store index range-scans doc_date
        AND doc_date >= CURRENT_DATE - 6
        ${mine}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<CategoryRow[]>`
      ${names}
      SELECT COALESCE(NULLIF(item_category_name, ''), 'ອື່ນໆ') AS category,
             COALESCE(SUM(sum_amount), 0) AS amount,
             COALESCE(SUM(qty), 0) AS qty
      FROM odg_sale_detail
      WHERE ${saleBasis()}
        AND ${saleReportCurrentMonth("odg_sale_detail")}
        ${mine}
      GROUP BY 1 ORDER BY amount DESC LIMIT 8
    `,
    prisma.$queryRaw<TopItemRow[]>`
      ${names}
      SELECT item_name,
             COALESCE(SUM(sum_amount), 0) AS amount,
             COALESCE(SUM(qty), 0) AS qty
      FROM odg_sale_detail
      WHERE ${saleBasis()}
        AND ${saleReportCurrentMonth("odg_sale_detail")}
        ${mine}
      GROUP BY item_name ORDER BY amount DESC LIMIT 5
    `,
    prisma.$queryRaw<RecentBillRow[]>`
      ${names}
      SELECT to_char(MAX(doc_date)::date, 'YYYY-MM-DD') AS day,
             doc_no,
             COALESCE(SUM(sum_amount), 0) AS amount,
             COUNT(*)::bigint AS items
      FROM odg_sale_detail
      WHERE ${saleBasis()}
        AND doc_date >= CURRENT_DATE - 30
        ${mine}
      GROUP BY doc_no ORDER BY MAX(doc_date) DESC LIMIT 8
    `,
    prisma.$queryRaw<PendingRow[]>`
      SELECT COUNT(*)::bigint AS count,
             COALESCE(SUM(total_amount_2), 0) AS amount
      FROM ic_trans
      WHERE doc_format_code = 'SOK'
        AND status = 0
        AND ${deptIn}
    `,
  ]);

  const d = saleDayRows[0];
  const m = saleMonthRows[0];
  const t = targetRows[0];
  const r = rankRows[0];
  const p = pendingRows[0];

  const targetSales = num(t?.sales);
  const targetAmount = num(t?.target);

  return {
    today: {
      sales: num(d?.today_sales),
      qty: num(d?.today_qty),
      bills: num(d?.today_bills),
    },
    yesterday: {
      sales: num(d?.yesterday_sales),
      qty: num(d?.yesterday_qty),
      bills: num(d?.yesterday_bills),
    },
    month: { sales: num(m?.month_sales), bills: num(m?.month_bills) },
    target: {
      sales: targetSales,
      qty: num(t?.qty),
      target: targetAmount,
      pct: targetAmount > 0 ? targetSales / targetAmount : 0,
    },
    rank: {
      teamSize: num(r?.team),
      day: { rank: num(r?.day_rnk), sales: num(r?.day_sales) },
      week: { rank: num(r?.week_rnk), sales: num(r?.week_sales) },
      month: { rank: num(r?.month_rnk), sales: num(r?.month_sales) },
    },
    daily: fillDays(dailyRows),
    categories: categoryRows.map((c) => ({
      category: c.category ?? "ອື່ນໆ",
      amount: num(c.amount),
      qty: num(c.qty),
    })),
    topItems: topItemRows.map((i) => ({
      name: i.item_name ?? "—",
      amount: num(i.amount),
      qty: num(i.qty),
    })),
    recentBills: recentBillRows.map((b) => ({
      day: b.day,
      docNo: b.doc_no,
      amount: num(b.amount),
      items: num(b.items),
    })),
    pending: { count: num(p?.count), amount: num(p?.amount) },
  };
}

// Seven entries, oldest first, zeroes included. A chart plotting only the
// days that had sales draws a rising line through a quiet week.
function fillDays(rows: DailyRow[]): HomeDashboard["daily"] {
  const byDay = new Map<string, { sales: number; bills: number }>();
  for (const row of rows) {
    const key = isoDay(row.day);
    byDay.set(key, { sales: num(row.total), bills: num(row.orders) });
  }
  const out: HomeDashboard["daily"] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDay(d);
    const hit = byDay.get(key);
    out.push({ day: key, sales: hit?.sales ?? 0, bills: hit?.bills ?? 0 });
  }
  return out;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
