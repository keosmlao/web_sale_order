import Link from "next/link";
import type { ReactNode } from "react";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee, canApprovePriceRequests } from "@/lib/roles";
import MyTargetCard, { type TargetDashboard } from "./MyTargetCard";
import MyBonusCard from "./MyBonusCard";
import ActivePromosCard from "./ActivePromosCard";
import LowStockBanner from "./cashier/LowStockBanner";
import DeliveryTodayCard from "./orders/new/DeliveryTodayCard";

export const dynamic = "force-dynamic";

// "ໜ້າຮ້ານ ຂົວຫຼວງ" — front-shop sales departments at the Khua Luang branch.
// The whole dashboard is scoped to these departments so every figure reflects
// what was sold / collected at the Khua Luang storefront.
//   2012 ເຄື່ອງໃຊ້ໄຟຟ້າ · 2022 ແອ · 2032 ປະປາ · 2042 ອາໄຫຼ່ · 2062 ໄຟຟ້ານ້ອຍ
// NOTE: the daily-sales report excludes 2042 (ອາໄຫຼ່) per a separate rule; the
// dashboard keeps it so the full storefront is represented. Drop "2042" here to
// align the two.
const KHUA_LUANG_DEPTS = ["2012", "2022", "2032", "2042", "2062"] as const;

// odg_employee department_code(s) that make up the Khua Luang front-store sales
// team. Used to scope the per-employee performance table for managers / heads.
// The front-store sellers (and their monthly targets in
// odg_retail_target_employee) span 204 ຂາຍສົ່ງແອ, 205 ຂາຍສົ່ງອາໄຫຼ່ and
// 207 ຂາຍຍ່ອຍຂົວຫຼວງ.
const FRONT_STORE_SALE_DEPTS = ["204", "205", "207"] as const;

type DayMetrics = {
  pending_count: bigint;
  completed_count: bigint;
  cancelled_count: bigint;
  pending_amount: string | number | null;
  completed_amount: string | number | null;
  cancelled_amount: string | number | null;
};

// Realised front-store sales for today vs yesterday, from odg_sale_detail
// (the denormalised sale sheet — same source as the incentives/my-sales reports).
type SaleDayRow = {
  today_sales: string | number | null;
  yesterday_sales: string | number | null;
  today_qty: string | number | null;
  yesterday_qty: string | number | null;
  today_bills: bigint;
  yesterday_bills: bigint;
};

type SaleMonthRow = {
  month_sales: string | number | null;
  month_bills: bigint | number | null;
};

type TopSalesperson = {
  user_owner: string | null;
  fullname_lo: string | null;
  nickname: string | null;
  orders: bigint;
  total: string | number | null;
  ytd_total: string | number | null;
  month_target: string | number | null;
  ytd_target: string | number | null;
};

type RecentOrder = {
  cart_number: string;
  user_owner: string | null;
  salesperson_name: string | null;
  customer_name: string | null;
  amount: string | number | null;
  status: number | null;
  create_date_time_now: Date;
};

type DailyBar = {
  day: Date;
  total: string | number | null;
  orders: bigint;
};

type PriceCounts = {
  pending: bigint;
  approved_today: bigint;
};

type HomeTargetRow = {
  sales: string | number | null;
  qty: string | number | null;
  target: string | number | null;
};

type HomeTargetDailyRow = {
  day: Date;
  sales: string | number | null;
  qty: string | number | null;
};

type CategoryRow = { category: string | null; amount: string | number | null; qty: string | number | null };
type TopItemRow = { item_name: string | null; amount: string | number | null; qty: string | number | null };
type RecentBillRow = { day: string; doc_no: string; amount: string | number | null; items: bigint };
type MyRankRow = {
  day_rnk: number | string | null;
  week_rnk: number | string | null;
  month_rnk: number | string | null;
  team: number | string | null;
  day_sales: number | string | null;
  week_sales: number | string | null;
  month_sales: number | string | null;
};

// Today's money actually received at the register — settled CAKAP receipts
// (not SOK sales orders). Cash / transfer split comes from app_payment_line.
const moneyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const compactMoneyFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const numFmt = new Intl.NumberFormat("en-US");

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Vientiane",
});

const dayShortFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  timeZone: "Asia/Vientiane",
});

const dateFmt = new Intl.DateTimeFormat("lo-LA", {
  weekday: "short",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Vientiane",
});

export default async function HomePage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const roleLabel =
    role === "manager" ? "ຜູ້ຈັດການ"
    : role === "head" ? "ຫົວໜ້າ"
    : role === "pc" ? "ແຄຊເຢຍ"
    : "ພະນັກງານຂາຍ";
  const canSeePriceRequests = canApprovePriceRequests(role);
  const displayName = me.fullnameLo || me.fullnameEn || me.employeeCode || "—";
  const greeting =
    me.nickname && me.nickname !== "0" ? me.nickname : displayName;

  // Front-shop department filter, in unaliased and `t.`-aliased forms so it
  // can drop into each query's WHERE.
  const deptIn = Prisma.sql`department_code IN (${Prisma.join([...KHUA_LUANG_DEPTS])})`;
  const deptInT = Prisma.sql`t.department_code IN (${Prisma.join([...KHUA_LUANG_DEPTS])})`;

  // The home page is a PERSONAL dashboard — every "my performance" card (today,
  // yesterday, month, week) shows only the logged-in person's own sales, for any
  // role from salesperson up to manager. Team-wide data lives in the leaderboard
  // card + the reports. `meNamesCte`/`meFilter` scope a query to this person via
  // their roster name + aliases.
  const meNamesCte = Prisma.sql`
      WITH names AS (
        SELECT fullname_lo AS salename FROM odg_employee
          WHERE employee_code = ${me.employeeCode ?? ""} AND COALESCE(fullname_lo, '') <> ''
        UNION
        SELECT salename FROM app_incentive_sale_alias
          WHERE employee_code = ${me.employeeCode ?? ""}
      )`;
  const meFilter = Prisma.sql`AND salename IN (SELECT salename FROM names)`;

  // Insight cards (category / best-sellers / recent) scope: managers & heads run
  // the whole front-store floor, so their team view aggregates ALL front-store
  // sales (no per-seller / per-department filter — the branch/argroup WHERE
  // already scopes it). Salespeople see only their own. (A single manager's
  // department_code can't cover sellers spread across several selling depts, so
  // department scoping left managers with empty cards.)
  const insightIsTeam = role === "manager" || role === "head";
  const insightNamesCte = insightIsTeam ? Prisma.empty : meNamesCte;
  const insightFilter = insightIsTeam ? Prisma.empty : meFilter;
  // Leaderboard ("ຍອດຂາຍຈິງຕາມພະນັກງານ"): managers/heads see the front-store
  // SALES department staff (FRONT_STORE_SALE_DEPTS); a salesperson sees only
  // their own department's peers.
  const leaderboardDeptFilter = insightIsTeam
    ? Prisma.sql`AND emp.department_code IN (${Prisma.join([...FRONT_STORE_SALE_DEPTS])})`
    : Prisma.sql`AND emp.department_code = ${me.departmentCode ?? ""}`;

  const [
    todayRows,
    topRows,
    recentRows,
    dailyRows,
    priceCountRows,
    saleDayRows,
    homeTargetRows,
    saleMonthRows,
    homeTargetDailyRows,
    pendingBillsRows,
    categoryRows,
    topItemRows,
    recentMineRows,
    myRankRows,
    refillPendingRows,
    monthCompareRows,
    newMemberRows,
  ] = await Promise.all([
    prisma.$queryRaw<DayMetrics[]>`
      SELECT
        COUNT(*) FILTER (WHERE status = 0)::bigint AS pending_count,
        COUNT(*) FILTER (WHERE status = 1)::bigint AS completed_count,
        COUNT(*) FILTER (WHERE status = 2)::bigint AS cancelled_count,
        COALESCE(SUM(total_amount_2) FILTER (WHERE status = 0), 0) AS pending_amount,
        COALESCE(SUM(total_amount_2) FILTER (WHERE status = 1), 0) AS completed_amount,
        COALESCE(SUM(total_amount_2) FILTER (WHERE status = 2), 0) AS cancelled_amount
      FROM ic_trans
      WHERE doc_format_code = 'SOK'
        AND create_date_time_now::date = CURRENT_DATE
        AND ${deptIn}
    `,
    prisma.$queryRaw<TopSalesperson[]>`
      -- Performance table per employee: this-month sales + target and YTD
      -- figures. Employee-based (not sale-based) so people with a target but
      -- no sales yet still show a 0 row. Sales resolved employee → salenames
      -- (roster fullname_lo + SML aliases).
      SELECT
        emp.employee_code AS user_owner,
        emp.fullname_lo,
        emp.nickname,
        COALESCE(s.orders, 0)::bigint AS orders,
        COALESCE(s.month_total, 0) AS total,
        COALESCE(s.ytd_total, 0) AS ytd_total,
        COALESCE(tg.month_target, 0) AS month_target,
        COALESCE(tg.ytd_target, 0) AS ytd_target
      FROM odg_employee emp
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE sd.doc_date >= date_trunc('month', CURRENT_DATE)), 0) AS month_total,
          COALESCE(SUM(sd.sum_amount), 0) AS ytd_total,
          COUNT(DISTINCT sd.doc_no) FILTER (WHERE sd.doc_date >= date_trunc('month', CURRENT_DATE)) AS orders
        FROM odg_sale_detail sd
        WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
          AND sd.doc_date >= date_trunc('year', CURRENT_DATE)
          AND sd.salename IN (
            SELECT emp.fullname_lo WHERE COALESCE(emp.fullname_lo, '') <> ''
            UNION
            SELECT a.salename FROM app_incentive_sale_alias a
              WHERE a.employee_code = emp.employee_code
          )
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(t.target) FILTER (WHERE LPAD(t.month, 2, '0') = to_char(CURRENT_DATE, 'MM')), 0) AS month_target,
          COALESCE(SUM(t.target) FILTER (WHERE LPAD(t.month, 2, '0') <= to_char(CURRENT_DATE, 'MM')), 0) AS ytd_target
        FROM odg_retail_target_employee t
        WHERE t.emp_code = emp.employee_code
          AND t.year = to_char(CURRENT_DATE, 'YYYY')
      ) tg ON true
      WHERE 1 = 1
        ${leaderboardDeptFilter}
        -- Only people with a target this month appear on the home table.
        AND COALESCE(tg.month_target, 0) > 0
      ORDER BY total DESC
      LIMIT 12
    `,
    prisma.$queryRaw<RecentOrder[]>`
      SELECT
        SUBSTRING(t.doc_no FROM 6) AS cart_number,
        eff.salesperson_code AS user_owner,
        COALESCE(emp.fullname_lo, emp.nickname, eff.salesperson_code) AS salesperson_name,
        ar.name_1 AS customer_name,
        t.total_amount_2 AS amount,
        t.status,
        t.create_date_time_now
      FROM ic_trans t
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          NULLIF(NULLIF(t.sale_code, ''), '00000'),
          NULLIF(NULLIF((
            SELECT d.sale_code
            FROM ic_trans_detail d
            WHERE d.doc_no = t.doc_no
              AND d.trans_type = t.trans_type
              AND d.trans_flag = t.trans_flag
            ORDER BY d.line_number
            LIMIT 1
          ), ''), '00000'),
          NULLIF(t.creator_code, '')
        ) AS salesperson_code
      ) eff ON true
      LEFT JOIN ar_customer ar ON ar.code = t.cust_code
      LEFT JOIN odg_employee emp ON emp.employee_code = eff.salesperson_code
      WHERE t.doc_format_code = 'SOK'
        AND ${deptInT}
      ORDER BY t.create_date_time_now DESC
      LIMIT 8
    `,
    prisma.$queryRaw<DailyBar[]>`
      ${insightNamesCte}
      SELECT
        doc_date::date AS day,
        COALESCE(SUM(sum_amount), 0) AS total,
        COUNT(DISTINCT doc_no)::bigint AS orders
      FROM odg_sale_detail
      WHERE branch_code = '01'
        AND argroup_main = '101'
        -- sargable (no ::date cast) so the front-store index range-scans doc_date
        AND doc_date >= CURRENT_DATE - 6
        ${insightFilter}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<PriceCounts[]>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::bigint AS pending,
        COUNT(*) FILTER (
          WHERE status = 'approved' AND decided_at::date = CURRENT_DATE
        )::bigint AS approved_today
      FROM app_price_request
    `,
    prisma.$queryRaw<SaleDayRow[]>`
      ${insightNamesCte}
      SELECT
        COALESCE(SUM(sum_amount) FILTER (WHERE doc_date::date = CURRENT_DATE), 0) AS today_sales,
        COALESCE(SUM(sum_amount) FILTER (WHERE doc_date::date = CURRENT_DATE - 1), 0) AS yesterday_sales,
        COALESCE(SUM(qty) FILTER (WHERE doc_date::date = CURRENT_DATE), 0) AS today_qty,
        COALESCE(SUM(qty) FILTER (WHERE doc_date::date = CURRENT_DATE - 1), 0) AS yesterday_qty,
        COUNT(DISTINCT doc_no) FILTER (WHERE doc_date::date = CURRENT_DATE)::bigint AS today_bills,
        COUNT(DISTINCT doc_no) FILTER (WHERE doc_date::date = CURRENT_DATE - 1)::bigint AS yesterday_bills
      FROM odg_sale_detail
      WHERE branch_code = '01'
        AND argroup_main = '101'
        AND doc_date >= CURRENT_DATE - 1
        ${insightFilter}
    `,
    role === "manager" || role === "head"
      ? prisma.$queryRaw<HomeTargetRow[]>`
          WITH roster AS (
            SELECT DISTINCT emp_code FROM odg_retail_target_employee
            WHERE year = to_char(CURRENT_DATE, 'YYYY')
              AND LPAD(month, 2, '0') = to_char(CURRENT_DATE, 'MM')
          ), names AS (
            SELECT employee.fullname_lo AS salename
            FROM odg_employee employee JOIN roster ON roster.emp_code = employee.employee_code
            WHERE COALESCE(employee.fullname_lo, '') <> ''
            UNION
            SELECT alias.salename FROM app_incentive_sale_alias alias
            JOIN roster ON roster.emp_code = alias.employee_code
          )
          SELECT
            COALESCE((SELECT SUM(detail.sum_amount) FROM odg_sale_detail detail
              WHERE detail.branch_code = '01' AND detail.argroup_main = '101'
                AND detail.doc_date >= date_trunc('month', CURRENT_DATE)
                AND detail.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                AND detail.salename IN (SELECT salename FROM names)), 0) AS sales,
            COALESCE((SELECT SUM(detail.qty) FROM odg_sale_detail detail
              WHERE detail.branch_code = '01' AND detail.argroup_main = '101'
                AND detail.doc_date >= date_trunc('month', CURRENT_DATE)
                AND detail.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                AND detail.salename IN (SELECT salename FROM names)), 0) AS qty,
            COALESCE((SELECT SUM(employee_target.target) FROM odg_retail_target_employee employee_target
              WHERE employee_target.year = to_char(CURRENT_DATE, 'YYYY')
                AND LPAD(employee_target.month, 2, '0') = to_char(CURRENT_DATE, 'MM')), 0) AS target
        `
      : prisma.$queryRaw<HomeTargetRow[]>`
          WITH names AS (
            SELECT fullname_lo AS salename FROM odg_employee
            WHERE employee_code = ${me.employeeCode ?? ""} AND COALESCE(fullname_lo, '') <> ''
            UNION SELECT salename FROM app_incentive_sale_alias
            WHERE employee_code = ${me.employeeCode ?? ""}
          )
          SELECT
            COALESCE((SELECT SUM(detail.sum_amount) FROM odg_sale_detail detail
              WHERE detail.branch_code = '01' AND detail.argroup_main = '101'
                AND detail.doc_date >= date_trunc('month', CURRENT_DATE)
                AND detail.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                AND detail.salename IN (SELECT salename FROM names)), 0) AS sales,
            COALESCE((SELECT SUM(detail.qty) FROM odg_sale_detail detail
              WHERE detail.branch_code = '01' AND detail.argroup_main = '101'
                AND detail.doc_date >= date_trunc('month', CURRENT_DATE)
                AND detail.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
                AND detail.salename IN (SELECT salename FROM names)), 0) AS qty,
            COALESCE((SELECT SUM(target) FROM odg_retail_target_employee
              WHERE emp_code = ${me.employeeCode ?? ""}
                AND year = to_char(CURRENT_DATE, 'YYYY')
                AND LPAD(month, 2, '0') = to_char(CURRENT_DATE, 'MM')), 0) AS target
        `,
    prisma.$queryRaw<SaleMonthRow[]>`
      ${insightNamesCte}
      SELECT
        COALESCE(SUM(sum_amount), 0) AS month_sales,
        COUNT(DISTINCT doc_no)::bigint AS month_bills
      FROM odg_sale_detail
      WHERE branch_code = '01'
        AND argroup_main = '101'
        AND doc_date >= date_trunc('month', CURRENT_DATE)
        AND doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
        ${insightFilter}
    `,
    role === "manager" || role === "head"
      ? prisma.$queryRaw<HomeTargetDailyRow[]>`
          WITH roster AS (
            SELECT DISTINCT emp_code FROM odg_retail_target_employee
            WHERE year = to_char(CURRENT_DATE, 'YYYY')
              AND LPAD(month, 2, '0') = to_char(CURRENT_DATE, 'MM')
          ), names AS (
            SELECT employee.fullname_lo AS salename
            FROM odg_employee employee JOIN roster ON roster.emp_code = employee.employee_code
            WHERE COALESCE(employee.fullname_lo, '') <> ''
            UNION
            SELECT alias.salename FROM app_incentive_sale_alias alias
            JOIN roster ON roster.emp_code = alias.employee_code
          )
          SELECT detail.doc_date::date AS day,
                 COALESCE(SUM(detail.sum_amount), 0) AS sales,
                 COALESCE(SUM(detail.qty), 0) AS qty
          FROM odg_sale_detail detail
          WHERE detail.branch_code = '01' AND detail.argroup_main = '101'
            AND detail.doc_date >= date_trunc('month', CURRENT_DATE)
            AND detail.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
            AND detail.salename IN (SELECT salename FROM names)
          GROUP BY detail.doc_date::date ORDER BY day
        `
      : prisma.$queryRaw<HomeTargetDailyRow[]>`
          WITH names AS (
            SELECT fullname_lo AS salename FROM odg_employee
            WHERE employee_code = ${me.employeeCode ?? ""} AND COALESCE(fullname_lo, '') <> ''
            UNION SELECT salename FROM app_incentive_sale_alias
            WHERE employee_code = ${me.employeeCode ?? ""}
          )
          SELECT detail.doc_date::date AS day,
                 COALESCE(SUM(detail.sum_amount), 0) AS sales,
                 COALESCE(SUM(detail.qty), 0) AS qty
          FROM odg_sale_detail detail
          WHERE detail.branch_code = '01' AND detail.argroup_main = '101'
            AND detail.doc_date >= date_trunc('month', CURRENT_DATE)
            AND detail.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
            AND detail.salename IN (SELECT salename FROM names)
          GROUP BY detail.doc_date::date ORDER BY day
        `,
    // Cashier queue — SOK bills still awaiting settlement (front-store).
    prisma.$queryRaw<Array<{ count: bigint; amount: string | number | null }>>`
      SELECT COUNT(*)::bigint AS count,
             COALESCE(SUM(total_amount_2), 0) AS amount
      FROM ic_trans
      WHERE doc_format_code = 'SOK'
        AND status = 0
        AND ${deptIn}
    `,
    // My sales by product category this month.
    prisma.$queryRaw<CategoryRow[]>`
      ${insightNamesCte}
      SELECT COALESCE(NULLIF(item_category_name, ''), 'ອື່ນໆ') AS category,
             COALESCE(SUM(sum_amount), 0) AS amount,
             COALESCE(SUM(qty), 0) AS qty
      FROM odg_sale_detail
      WHERE branch_code = '01' AND argroup_main = '101'
        AND doc_date >= date_trunc('month', CURRENT_DATE)
        AND doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
        ${insightFilter}
      GROUP BY 1 ORDER BY amount DESC LIMIT 8
    `,
    // My best-selling items this month.
    prisma.$queryRaw<TopItemRow[]>`
      ${insightNamesCte}
      SELECT item_name,
             COALESCE(SUM(sum_amount), 0) AS amount,
             COALESCE(SUM(qty), 0) AS qty
      FROM odg_sale_detail
      WHERE branch_code = '01' AND argroup_main = '101'
        AND doc_date >= date_trunc('month', CURRENT_DATE)
        AND doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
        ${insightFilter}
      GROUP BY item_name ORDER BY amount DESC LIMIT 5
    `,
    // My most recent bills (last 30 days).
    prisma.$queryRaw<RecentBillRow[]>`
      ${insightNamesCte}
      SELECT to_char(MAX(doc_date)::date, 'YYYY-MM-DD') AS day,
             doc_no,
             COALESCE(SUM(sum_amount), 0) AS amount,
             COUNT(*)::bigint AS items
      FROM odg_sale_detail
      WHERE branch_code = '01' AND argroup_main = '101'
        AND doc_date >= CURRENT_DATE - 30
        ${insightFilter}
      GROUP BY doc_no ORDER BY MAX(doc_date) DESC LIMIT 8
    `,
    // My rank within my department — today / this week / this month.
    prisma.$queryRaw<MyRankRow[]>`
      WITH sold AS (
        SELECT emp.employee_code, emp.department_code,
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE sd.doc_date::date = CURRENT_DATE), 0) AS day_sales,
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE sd.doc_date >= date_trunc('week', CURRENT_DATE)), 0) AS week_sales,
          COALESCE(SUM(sd.sum_amount) FILTER (WHERE sd.doc_date >= date_trunc('month', CURRENT_DATE)), 0) AS month_sales
        FROM odg_sale_detail sd
        LEFT JOIN LATERAL (
          SELECT employee_code FROM (
            SELECT a.employee_code, 0 AS pr FROM app_incentive_sale_alias a WHERE a.salename = sd.salename
            UNION ALL SELECT e.employee_code, 1 FROM odg_employee e WHERE e.fullname_lo = sd.salename
          ) q ORDER BY pr, employee_code LIMIT 1
        ) resolved ON true
        LEFT JOIN odg_employee emp ON emp.employee_code = resolved.employee_code
        WHERE sd.branch_code = '01' AND sd.argroup_main = '101'
          AND sd.doc_date >= LEAST(date_trunc('month', CURRENT_DATE), date_trunc('week', CURRENT_DATE))
          AND resolved.employee_code IS NOT NULL
        GROUP BY emp.employee_code, emp.department_code
      ),
      dept AS (SELECT * FROM sold WHERE department_code = ${me.departmentCode ?? ""}),
      ranked AS (
        SELECT employee_code, day_sales, week_sales, month_sales,
          RANK() OVER (ORDER BY day_sales DESC) AS day_rnk,
          RANK() OVER (ORDER BY week_sales DESC) AS week_rnk,
          RANK() OVER (ORDER BY month_sales DESC) AS month_rnk,
          COUNT(*) OVER () AS team
        FROM dept
      )
      SELECT day_rnk, week_rnk, month_rnk, team, day_sales, week_sales, month_sales
      FROM ranked WHERE employee_code = ${me.employeeCode ?? ""}
    `,
    // Pending stock-refill requests (awaiting approval). Best-effort: a missing
    // table must not crash the whole dashboard.
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM app_stock_refill_request
      WHERE status = 'pending'
    `.catch(() => [] as Array<{ count: bigint }>),
    // Month-to-date vs the SAME day-span of last month (front-store, team-wide)
    // — a fair month-direction signal for managers/heads.
    role === "manager" || role === "head"
      ? prisma.$queryRaw<Array<{ cur_sales: string | number | null; prev_sales: string | number | null }>>`
          SELECT
            COALESCE(SUM(sum_amount) FILTER (WHERE doc_date >= date_trunc('month', CURRENT_DATE)), 0) AS cur_sales,
            COALESCE(SUM(sum_amount) FILTER (WHERE
              doc_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
              AND doc_date < date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
                + (CURRENT_DATE - date_trunc('month', CURRENT_DATE)::date + 1) * INTERVAL '1 day'
            ), 0) AS prev_sales
          FROM odg_sale_detail
          WHERE branch_code = '01' AND argroup_main = '101'
            AND doc_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
        `
      : Promise.resolve([] as Array<{ cur_sales: string | number | null; prev_sales: string | number | null }>),
    // New loyalty members registered this month (managers/heads).
    role === "manager" || role === "head"
      ? prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM ar_customer
          WHERE LOWER(TRIM(COALESCE(reg_group, ''))) = 'member'
            AND create_date_time_now >= date_trunc('month', CURRENT_DATE)
        `.catch(() => [] as Array<{ count: bigint }>)
      : Promise.resolve([] as Array<{ count: bigint }>),
  ]);

  const today = normalizeMetrics(todayRows[0]);

  // Today vs yesterday realised sales come from odg_sale_detail (actual sale
  // sheet), not SOK sale-orders — those can include unrealised/pending carts.
  const saleDay = saleDayRows[0];
  const todayTotal = Number(saleDay?.today_sales ?? 0);
  const yesterdayTotal = Number(saleDay?.yesterday_sales ?? 0);
  const saleMonth = saleMonthRows[0];
  const monthTotal = Number(saleMonth?.month_sales ?? 0);
  const todayOrders = Number(saleDay?.today_bills ?? 0);
  const yesterdayOrders = Number(saleDay?.yesterday_bills ?? 0);
  const monthOrders = Number(saleMonth?.month_bills ?? 0);
  const avg = todayOrders > 0 ? todayTotal / todayOrders : 0;

  const totalDeltaPct = pctDelta(todayTotal, yesterdayTotal);
  const ordersDeltaPct = pctDelta(todayOrders, yesterdayOrders);

  const dailySeries = buildDailySeries(dailyRows);
  const weekTotal = dailySeries.reduce((s, d) => s + d.total, 0);
  const weekOrders = dailySeries.reduce((s, d) => s + d.orders, 0);
  const highestDay = dailySeries.reduce(
    (max, d) => (d.total > max.total ? d : max),
    { total: 0, date: new Date() }
  );

  const topTotal = Number(topRows[0]?.total ?? 0);
  const priceCounts = priceCountRows[0];
  const pendingPriceRequests = Number(priceCounts?.pending ?? 0);
  const approvedPricesToday = Number(priceCounts?.approved_today ?? 0);
  const pendingBills = pendingBillsRows[0];
  const pendingBillsCount = Number(pendingBills?.count ?? 0);
  const pendingBillsAmount = Number(pendingBills?.amount ?? 0);
  // Operational overview (delivery / low stock / cashier queue) is for the
  // people who run the floor — heads and managers.
  const isManagerOrHead = role === "manager" || role === "head";
  const myRank = myRankRows[0];
  const myTeamSize = Number(myRank?.team ?? 0);
  const rankPeriods = [
    { label: "ວັນ", rnk: Number(myRank?.day_rnk ?? 0), amount: Number(myRank?.day_sales ?? 0) },
    { label: "ອາທິດ", rnk: Number(myRank?.week_rnk ?? 0), amount: Number(myRank?.week_sales ?? 0) },
    { label: "ເດືອນ", rnk: Number(myRank?.month_rnk ?? 0), amount: Number(myRank?.month_sales ?? 0) },
  ];
  const catMax = Math.max(1, ...categoryRows.map((c) => Number(c.amount ?? 0)));
  const refillPendingCount = Number(refillPendingRows[0]?.count ?? 0);
  // Month direction: this month-to-date vs the same day-span of last month.
  const monthCompare = monthCompareRows[0];
  const mtdCur = Number(monthCompare?.cur_sales ?? 0);
  const mtdPrev = Number(monthCompare?.prev_sales ?? 0);
  const mtdDeltaPct = mtdPrev > 0 ? ((mtdCur - mtdPrev) / mtdPrev) * 100 : null;
  const newMembersCount = Number(newMemberRows[0]?.count ?? 0);
  const homeTarget = homeTargetRows[0];
  const homeTargetSales = Number(homeTarget?.sales ?? 0);
  const homeTargetAmount = Number(homeTarget?.target ?? 0);
  const initialTargetData: TargetDashboard = {
    totalSales: homeTargetSales,
    totalQty: Number(homeTarget?.qty ?? 0),
    target: homeTargetAmount,
    achievementPct: homeTargetAmount > 0 ? homeTargetSales / homeTargetAmount : 0,
    rank: 0,
    teamSize: 0,
    daily: homeTargetDailyRows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      sales: Number(row.sales ?? 0),
      qty: Number(row.qty ?? 0),
    })),
    scope: role === "manager" || role === "head" ? "team" : "employee",
  };

  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Vientiane",
    }).format(now)
  );
  const timeOfDay =
    hour < 11
      ? "ສະບາຍດີຕອນເຊົ້າ"
      : hour < 17
        ? "ສະບາຍດີຕອນບ່າຍ"
        : "ສະບາຍດີຕອນແລງ";

  const totalBothDays = todayTotal + yesterdayTotal;
  const todayRatio = totalBothDays > 0 ? (todayTotal / totalBothDays) * 100 : 50;

  return (
    <div className="space-y-4 px-3 py-3 pb-[calc(20px+env(safe-area-inset-bottom))] sm:space-y-6 sm:px-6 sm:py-6 lg:px-8">
      {/* Premium Hero Banner Greeting */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4 text-white shadow-lg sm:p-6 md:p-8">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px] opacity-20" />
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-300">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-emerald-300 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online
              </span>
              <span>·</span>
              <span>{dateFmt.format(now)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl md:text-3xl">
                {timeOfDay}, {greeting}
              </h1>
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-inset ring-white/20">
                {roleLabel}
              </span>
            </div>
            <p className="max-w-xl text-xs text-slate-300">
              Dashboard ສ່ວນຕົວ · ຍອດຂາຍ, ເປົ້າ ແລະ ໂບນັດ ຂອງທ່ານມື້ນີ້
            </p>
          </div>

        </div>

        {/* My rank — one compact row inside the hero (day / week / month). */}
        {myTeamSize > 0 ? (
          <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
            {rankPeriods.map((p) => {
              const disc =
                p.rnk === 1 ? "from-amber-300 to-yellow-500 text-amber-950"
                : p.rnk === 2 ? "from-slate-100 to-slate-400 text-slate-800"
                : p.rnk === 3 ? "from-orange-300 to-orange-500 text-orange-950"
                : "from-slate-600 to-slate-700 text-slate-300";
              return (
                <div key={p.label} className="flex items-center justify-center gap-1.5">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-mono text-[11px] font-black ${disc}`}>
                    {p.rnk > 0 ? p.rnk : "–"}
                  </span>
                  <div className="min-w-0 text-left leading-tight">
                    <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400">
                      {p.label} · /{myTeamSize}
                    </div>
                    <div className="truncate font-mono text-[11px] font-black text-slate-100">
                      {compactMoneyFmt.format(p.amount)} <span className="text-[8px] font-bold text-slate-400">ບາດ</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Thumb-friendly launchers stay near the top on phones. */}
      <section className="grid grid-cols-3 gap-2 sm:hidden" aria-label="ທາງລັດ">
        <MobileLauncher href="/orders/new" label="ສ້າງບິນ" icon={<PosIcon />} accent="primary" />
        <MobileLauncher href="/cashier" label="ຮັບເງິນ" icon={<CashIcon />} accent="warning" />
        <MobileLauncher href="/reports/incentives" label="ໂບນັດ" icon={<SalesIcon />} accent="success" />
      </section>

      {/* Bonus card first — its "ລວມທີ່ຕ້ອງຮັບ" headline must be visible the
          moment the home page opens. Phones stack; desktop puts bonus and
          target side by side so the page stops reading like a stretched
          phone layout. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <MyBonusCard />
        <MyTargetCard initialData={initialTargetData} />
      </div>

      {/* Running promotions — what to push today. Hidden when none active. */}
      <ActivePromosCard />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <MetricCard
          title="ຍອດຂາຍມື້ນີ້"
          value={moneyFmt.format(todayTotal)}
          unit="ບາດ"
          sub={`${numFmt.format(todayOrders)} ບິນ · ສະເລ່ຍ ${compactMoneyFmt.format(avg)}/ບິນ`}
          delta={totalDeltaPct}
          icon={<SalesIcon />}
          accent="info"
          />
        </div>
        <MetricCard
          title="ຈຳນວນບິນ"
          value={numFmt.format(todayOrders)}
          sub={`ມື້ວານ ${numFmt.format(yesterdayOrders)} ບິນ · ລໍຖ້າຊຳລະ ${numFmt.format(today.pendingCount)}`}
          delta={ordersDeltaPct}
          icon={<ReceiptIcon />}
          accent="success"
        />
        <MetricCard
          title="ຍອດຂາຍເດືອນນີ້"
          value={moneyFmt.format(monthTotal)}
          unit="ບາດ"
          sub={`${numFmt.format(monthOrders)} ບິນໃນເດືອນນີ້`}
          icon={<CalendarIcon />}
          accent="warning"
        />
      </section>

      {/* Operations overview — heads / managers who run the floor. */}
      {isManagerOrHead ? (
        <SectionHeading title="ພາບລວມທີມ / ຄຸມງານ" subtitle="ຍອດທີມ · ແຈ້ງເຕືອນ · ອະນຸມັດ" />
      ) : null}
      {isManagerOrHead ? (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="ພາບລວມການປະຕິບັດງານ">
          {/* Team KPI: team sales vs target this month. */}
          <div className="grid grid-cols-3 divide-x divide-indigo-100 rounded-xl border border-indigo-100 bg-indigo-50/50 py-3 lg:col-span-2">
            <div className="px-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">ຍອດທີມ/ເດືອນ</div>
              <div className="mt-1 font-mono text-sm font-black text-indigo-700 sm:text-base">{moneyFmt.format(homeTargetSales)}</div>
            </div>
            <div className="px-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">ເປົ້າທີມ</div>
              <div className="mt-1 font-mono text-sm font-black text-slate-700 sm:text-base">{moneyFmt.format(homeTargetAmount)}</div>
            </div>
            <div className="px-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">ບັນລຸ</div>
              <div className={`mt-1 font-mono text-sm font-black sm:text-base ${homeTargetAmount > 0 && homeTargetSales / homeTargetAmount >= 1 ? "text-emerald-600" : homeTargetAmount > 0 && homeTargetSales / homeTargetAmount >= 0.8 ? "text-amber-600" : "text-slate-500"}`}>
                {homeTargetAmount > 0 ? `${((homeTargetSales / homeTargetAmount) * 100).toFixed(0)}%` : "—"}
              </div>
            </div>
          </div>
          {/* Month direction: this month vs the same days of last month. */}
          {mtdPrev > 0 || mtdCur > 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5">
              <div className="text-[11px] font-bold text-slate-500">
                ທຽບເດືອນກ່ອນ <span className="text-slate-400">(ວັນທີ 1–{new Date().getDate()})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-black text-slate-800">{compactMoneyFmt.format(mtdCur)}</span>
                <span className="text-[10px] text-slate-400">vs {compactMoneyFmt.format(mtdPrev)}</span>
                {mtdDeltaPct !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${mtdDeltaPct >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                    {mtdDeltaPct >= 0 ? "+" : ""}{mtdDeltaPct.toFixed(1)}%
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {/* Cancelled bills today — unusual cancellations are a floor-problem signal. */}
          {today.cancelledCount > 0 ? (
            <Link
              href="/orders"
              className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 transition hover:bg-rose-100"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500 text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m15 9-6 6M9 9l6 6" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-black text-rose-900">
                    ບິນຍົກເລີກມື້ນີ້ {numFmt.format(today.cancelledCount)} ບິນ
                  </div>
                  <div className="text-[11px] font-semibold text-rose-700">
                    ລວມ {moneyFmt.format(today.cancelledAmount)} ກີບ · ກົດເພື່ອກວດ
                  </div>
                </div>
              </div>
              <span className="text-lg text-rose-700">›</span>
            </Link>
          ) : null}
          {/* New loyalty members registered this month. */}
          {newMembersCount > 0 ? (
            <Link
              href="/members"
              className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 transition hover:bg-teal-100"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <circle cx="9" cy="8" r="4" />
                    <path d="M2 21a7 7 0 0 1 14 0" />
                    <path d="M19 8v6M22 11h-6" />
                  </svg>
                </span>
                <div className="text-sm font-black text-teal-900">
                  ສະມາຊິກໃໝ່ເດືອນນີ້ {numFmt.format(newMembersCount)} ຄົນ
                </div>
              </div>
              <span className="text-lg text-teal-700">›</span>
            </Link>
          ) : null}
          {pendingBillsCount > 0 ? (
            <Link
              href="/cashier"
              className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 transition hover:bg-amber-100"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-white">
                  <ReceiptIcon />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-black text-amber-900">
                    ບິນຄ້າງຊຳລະ {numFmt.format(pendingBillsCount)} ບິນ
                  </div>
                  <div className="text-[11px] font-semibold text-amber-700">
                    ລວມ {moneyFmt.format(pendingBillsAmount)} ກີບ · ກົດໄປຮັບເງິນ
                  </div>
                </div>
              </div>
              <span className="text-lg text-amber-700">›</span>
            </Link>
          ) : null}
          <div className="lg:col-span-2"><LowStockBanner /></div>
          {refillPendingCount > 0 ? (
            <Link
              href="/reports/stock-refill"
              className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 transition hover:bg-sky-100"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500 text-white">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <path d="M12 22V12" />
                    <path d="m3.3 7 8.7 5 8.7-5" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-black text-sky-900">
                    ຄຳຂໍເຕີມ stock {numFmt.format(refillPendingCount)} ລາຍການ
                  </div>
                  <div className="text-[11px] font-semibold text-sky-700">
                    ລໍຖ້າອະນຸມັດ · ກົດເພື່ອກວດ
                  </div>
                </div>
              </div>
              <span className="text-lg text-sky-700">›</span>
            </Link>
          ) : null}
          <div className="lg:col-span-2"><DeliveryTodayCard /></div>
        </section>
      ) : null}

      {/* Personal insights — my category mix, best sellers, recent bills. */}
      {/* Per-employee performance table — placed above the category insights. */}
      <section>
          <Panel
            title="ຍອດຂາຍຈິງຕາມພະນັກງານ"
            eyebrow="ເດືອນນີ້"
            action={
              <Link
                href="/reports/salespeople"
                className="text-xs font-semibold text-odoo-primary hover:underline"
              >
                ທັງໝົດ
              </Link>
            }
          >
            {topRows.length === 0 ? (
              <EmptyHint>ຍັງບໍ່ມີຍອດຂາຍເດືອນນີ້</EmptyHint>
            ) : (() => {
              const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
              const achPill = (pct: number) =>
                pct >= 100
                  ? "bg-emerald-50 text-emerald-600"
                  : pct >= 80
                    ? "bg-amber-50 text-amber-600"
                    : "bg-rose-50 text-rose-600";
              return (
                <div className="-mx-2 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead>
                      <tr className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <th className="px-2 py-1.5 text-left">ພະນັກງານ</th>
                        <th className="px-2 py-1.5 text-right">ເປົ້າ</th>
                        <th className="px-2 py-1.5 text-right">ຍອດຂາຍ</th>
                        <th className="px-2 py-1.5 text-center">Ach%</th>
                        <th className="px-2 py-1.5 text-center">Days</th>
                        <th className="px-2 py-1.5 text-right">Req/Day</th>
                        <th className="px-2 py-1.5 text-right text-slate-300">YTD Target</th>
                        <th className="px-2 py-1.5 text-right text-slate-300">YTD Actual</th>
                        <th className="px-2 py-1.5 text-right">YTD%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topRows.map((r, i) => {
                        const total = Number(r.total ?? 0);
                        const target = Number(r.month_target ?? 0);
                        const ytdTotal = Number(r.ytd_total ?? 0);
                        const ytdTarget = Number(r.ytd_target ?? 0);
                        const ach = target > 0 ? (total / target) * 100 : 0;
                        const reqPerDay = (target - total) / daysLeft;
                        const ytdPct = ytdTarget > 0 ? (ytdTotal / ytdTarget) * 100 : 0;
                        const name =
                          r.fullname_lo?.trim() || r.nickname?.trim() || r.user_owner || "ບໍ່ລະບຸ";
                        return (
                          <tr key={(r.user_owner ?? "") + i} className="hover:bg-slate-50">
                            <td className="max-w-36 truncate px-2 py-2 font-bold text-slate-800">{name}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-500">{moneyFmt.format(target)}</td>
                            <td className="px-2 py-2 text-right font-mono font-black text-slate-800">{moneyFmt.format(total)}</td>
                            <td className="px-2 py-2 text-center">
                              <span className={`inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-black ${achPill(ach)}`}>
                                {ach.toFixed(1)}%
                              </span>
                              <div className="mx-auto mt-1 h-1 w-16 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${ach >= 100 ? "bg-emerald-500" : ach >= 80 ? "bg-amber-400" : "bg-rose-400"}`}
                                  style={{ width: `${Math.min(100, Math.max(2, ach))}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center font-mono text-slate-500">{daysLeft}</td>
                            <td className={`px-2 py-2 text-right font-mono font-bold ${reqPerDay <= 0 ? "text-emerald-600" : "text-indigo-600"}`}>
                              {moneyFmt.format(Math.round(reqPerDay))}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{moneyFmt.format(ytdTarget)}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{moneyFmt.format(ytdTotal)}</td>
                            <td className="px-2 py-2 text-right font-mono font-black text-slate-700">
                              {ytdPct.toFixed(0)}%
                              <div className="ml-auto mt-1 h-1 w-14 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${ytdPct >= 100 ? "bg-emerald-500" : ytdPct >= 80 ? "bg-amber-400" : "bg-rose-400"}`}
                                  style={{ width: `${Math.min(100, Math.max(2, ytdPct))}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="ຍອດຂາຍຕາມໝວດ" eyebrow={insightIsTeam ? "ທີມ · ເດືອນນີ້" : "ຂອງຂ້ອຍ · ເດືອນນີ້"}>
          {categoryRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີຍອດຂາຍ</EmptyHint>
          ) : (
            <ul className="space-y-2.5">
              {categoryRows.map((c, i) => {
                const amt = Number(c.amount ?? 0);
                const pct = catMax > 0 ? (amt / catMax) * 100 : 0;
                return (
                  <li key={i}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="min-w-0 truncate font-semibold text-slate-700">{c.category}</span>
                      <span className="shrink-0 font-mono font-bold text-slate-800">{compactMoneyFmt.format(amt)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(3, pct)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={insightIsTeam ? "ສິນຄ້າຂາຍດີ (ທີມ)" : "ສິນຄ້າຂາຍດີຂອງຂ້ອຍ"} eyebrow="ເດືອນນີ້">
          {topItemRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີ</EmptyHint>
          ) : (
            <ul className="space-y-2">
              {topItemRows.map((it, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={rankBadgeClass(i)}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-slate-800">{it.item_name ?? "—"}</span>
                    <span className="text-[10px] text-slate-400">x{numFmt.format(Number(it.qty ?? 0))}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs font-black text-indigo-600">{compactMoneyFmt.format(Number(it.amount ?? 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={insightIsTeam ? "ຂາຍລ່າສຸດ (ທີມ)" : "ຂາຍລ່າສຸດຂອງຂ້ອຍ"} eyebrow="30 ວັນ">
          {recentMineRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີ</EmptyHint>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentMineRows.map((b, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-xs">
                  <span className="text-slate-500">
                    <span className="font-mono font-bold text-slate-700">#{b.doc_no.slice(-5)}</span>{" "}
                    <span className="text-slate-400">{b.day.slice(8, 10)}/{b.day.slice(5, 7)}</span>{" "}
                    · {numFmt.format(Number(b.items))} ລາຍການ
                  </span>
                  <span className="shrink-0 font-mono font-bold text-slate-800">{compactMoneyFmt.format(Number(b.amount ?? 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.9fr)]">
        <div className="space-y-5">
          <div className="hidden sm:block">
          <Panel
            title="ຍອດຂາຍ 7 ວັນຍ້ອນຫຼັງ"
            eyebrow="Sales trend"
            action={
              <Link
                href="/reports/daily-sales"
                className="text-xs font-semibold text-odoo-primary hover:underline"
              >
                ເບິ່ງລາຍງານ
              </Link>
            }
          >
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MiniStat label="ຮວມ 7 ວັນ" value={`${moneyFmt.format(weekTotal)} ບາດ`} />
              <MiniStat label="ຈຳນວນບິນ" value={`${numFmt.format(weekOrders)} ບິນ`} />
              <MiniStat
                label="ວັນສູງສຸດ"
                value={`${compactMoneyFmt.format(highestDay.total)} ບາດ`}
              />
            </div>
            <AreaChart series={dailySeries} />
          </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
            <Panel title="ມື້ນີ້ ທຽບກັບ ມື້ວານ" eyebrow="Comparison">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      ສັດສ່ວນຍອດຂາຍ
                    </span>
                    <span className="text-slate-400 font-semibold">
                      ຮວມ {moneyFmt.format(totalBothDays)} ບາດ
                    </span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
                    <div
                      className="bg-indigo-500 rounded-full"
                      style={{ width: `${todayRatio.toFixed(1)}%` }}
                    />
                    <div className="flex-1 bg-slate-200" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SplitStat
                    label="ມື້ນີ້"
                    value={`${moneyFmt.format(todayTotal)} ບາດ`}
                    meta={`${todayRatio.toFixed(0)}%`}
                    tone="primary"
                  />
                  <SplitStat
                    label="ມື້ວານ"
                    value={`${moneyFmt.format(yesterdayTotal)} ບາດ`}
                    meta={`${(100 - todayRatio).toFixed(0)}%`}
                    tone="muted"
                  />
                </div>
              </div>
            </Panel>

            {/* Salespeople don't approve special prices — hide the card for them. */}
            {role !== "salesperson" ? (
              <PriceRequestPanel
                canSeePriceRequests={canSeePriceRequests}
                pendingPriceRequests={pendingPriceRequests}
                approvedPricesToday={approvedPricesToday}
              />
            ) : null}
          </div>

          <div className="hidden sm:block">
            <Panel title="ທາງລັດ" eyebrow="Quick actions">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <LauncherButton
                  href="/orders/new"
                  label="POS / ສ້າງບິນ"
                  icon={<PosIcon />}
                  accent="primary"
                />
                <LauncherButton
                  href="/cashier"
                  label="ຮັບເງິນ"
                  icon={<CashIcon />}
                  accent="warning"
                />
                <LauncherButton
                  href="/employees"
                  label="ຈັດການທີມ"
                  icon={<UsersIcon />}
                  accent="success"
                />
              </div>
            </Panel>
          </div>
        </div>

        <aside className="space-y-4 sm:space-y-5">
          <Panel title="ກິດຈະກຳຫຼ້າສຸດ" eyebrow="Recent orders">
            {recentRows.length === 0 ? (
              <EmptyHint>ຍັງບໍ່ມີ Order</EmptyHint>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentRows.map((r) => (
                  <li key={r.cart_number} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <span className={"mt-1.5 h-2 w-2 rounded-full " + statusDotBg(r.status)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-slate-800">
                              {r.customer_name ?? "—"}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400 font-semibold">
                              <span>{r.salesperson_name ?? "—"}</span>
                              <span>#{r.cart_number}</span>
                              <span>{timeFmt.format(new Date(r.create_date_time_now))}</span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xs font-black text-slate-800">
                              {compactMoneyFmt.format(Number(r.amount ?? 0))}
                            </div>
                            <StatusPill status={r.status} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </section>
    </div>
  );
}

function normalizeMetrics(row: DayMetrics | undefined) {
  return {
    pendingCount: Number(row?.pending_count ?? 0),
    completedCount: Number(row?.completed_count ?? 0),
    cancelledCount: Number(row?.cancelled_count ?? 0),
    pendingAmount: Number(row?.pending_amount ?? 0),
    completedAmount: Number(row?.completed_amount ?? 0),
    cancelledAmount: Number(row?.cancelled_amount ?? 0),
  };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function laoDateIso(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function buildDailySeries(rows: DailyBar[]) {
  const map = new Map<string, { total: number; orders: number }>();
  for (const r of rows) {
    const iso = r.day.toISOString().slice(0, 10);
    map.set(iso, {
      total: Number(r.total ?? 0),
      orders: Number(r.orders ?? 0),
    });
  }
  const series: Array<{
    iso: string;
    date: Date;
    total: number;
    orders: number;
    isToday: boolean;
  }> = [];
  const todayIso = laoDateIso(new Date());
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const baseUtc = Date.UTC(ty, tm - 1, td);
  for (let i = 6; i >= 0; i--) {
    const date = new Date(baseUtc - i * 86_400_000);
    const iso = date.toISOString().slice(0, 10);
    const m = map.get(iso) ?? { total: 0, orders: 0 };
    series.push({
      iso,
      date,
      total: m.total,
      orders: m.orders,
      isToday: iso === todayIso,
    });
  }
  return series;
}

type AccentName = "primary" | "warning" | "success" | "info";

const ACCENTS: Record<
  AccentName,
  { icon: string; border: string; text: string; soft: string }
> = {
  primary: {
    icon: "bg-odoo-primary-50 text-odoo-primary",
    border: "border-l-odoo-primary",
    text: "text-odoo-primary",
    soft: "bg-odoo-primary-50 text-odoo-primary",
  },
  warning: {
    icon: "bg-odoo-warning-bg text-odoo-warning-text",
    border: "border-l-odoo-warning",
    text: "text-odoo-warning-text",
    soft: "bg-odoo-warning-bg text-odoo-warning-text",
  },
  success: {
    icon: "bg-odoo-success-bg text-odoo-success-text",
    border: "border-l-odoo-success",
    text: "text-odoo-success-text",
    soft: "bg-odoo-success-bg text-odoo-success-text",
  },
  info: {
    icon: "bg-odoo-info-bg text-odoo-info-text",
    border: "border-l-odoo-info",
    text: "text-odoo-info-text",
    soft: "bg-odoo-info-bg text-odoo-info-text",
  },
};

function Panel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="odoo-card p-5 hover:shadow-lg transition-all duration-300">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {eyebrow ? (
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-odoo-text-soft">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="text-sm font-bold text-odoo-text-strong">{title}</h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  title,
  value,
  unit,
  sub,
  delta,
  icon,
  accent,
}: {
  title: string;
  value: string;
  unit?: string;
  sub?: string;
  delta?: number | null;
  icon: ReactNode;
  accent: AccentName;
}) {
  const c = ACCENTS[accent];
  // Compact one-row layout: icon left, title/value/sub stacked beside it —
  // roughly a third the height of the old stacked card.
  return (
    <article className={`odoo-card border-l-4 ${c.border} p-3 transition-shadow duration-300 hover:shadow-lg`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${c.icon}`}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[10px] font-semibold text-odoo-text-muted">{title}</span>
            {delta !== undefined && delta !== null ? <DeltaPill value={delta} /> : null}
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <span className="break-all text-base font-bold leading-tight text-odoo-text-strong sm:text-lg">
              {value}
            </span>
            {unit ? <span className="text-[9px] font-semibold text-odoo-text-muted">{unit}</span> : null}
          </div>
          {sub ? <div className="truncate text-[9px] text-odoo-text-muted">{sub}</div> : null}
        </div>
      </div>
    </article>
  );
}

function DeltaPill({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold " +
        (positive
          ? "bg-odoo-success-bg text-odoo-success-text"
          : "bg-odoo-danger-bg text-odoo-danger-text")
      }
    >
      {positive ? "+" : "-"}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 pt-1">
      <h2 className="text-sm font-black text-odoo-text-strong">{title}</h2>
      {subtitle ? <span className="text-[11px] font-semibold text-odoo-text-muted">{subtitle}</span> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2">
      <div className="text-[9px] font-semibold text-odoo-text-muted">{label}</div>
      <div className="mt-1 truncate text-xs font-bold text-odoo-text-strong">{value}</div>
    </div>
  );
}

function SplitStat({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  tone: "primary" | "muted";
}) {
  return (
    <div className="rounded-md border border-odoo-border bg-odoo-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-odoo-text-muted">{label}</span>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-bold " +
            (tone === "primary"
              ? "bg-odoo-primary-50 text-odoo-primary"
              : "bg-slate-200 text-slate-700")
          }
        >
          {meta}
        </span>
      </div>
      <div className="mt-2 text-xs font-bold text-odoo-text-strong">{value}</div>
    </div>
  );
}

function PriceRequestPanel({
  canSeePriceRequests,
  pendingPriceRequests,
  approvedPricesToday,
}: {
  canSeePriceRequests: boolean;
  pendingPriceRequests: number;
  approvedPricesToday: number;
}) {
  const hasPending = pendingPriceRequests > 0;
  return (
    <section
      className={
        "rounded-lg border p-4 shadow-sm " +
        (hasPending
          ? "border-odoo-danger-border bg-odoo-danger-bg"
          : "border-odoo-border bg-white")
      }
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          className={
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md " +
            (hasPending
              ? "bg-white text-odoo-danger"
              : "bg-odoo-primary-50 text-odoo-primary")
          }
        >
          <TagIcon />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold text-odoo-text-strong">
            ອະນຸມັດລາຄາພິເສດ
          </div>
          <p className="mt-1 text-[10px] text-odoo-text-muted">
            {hasPending
              ? `ມີ ${pendingPriceRequests} ລາຍການລໍຖ້າການອະນຸມັດ`
              : "ບໍ່ມີຄຳຂໍລາຄາພິເສດໃນຂະນະນີ້"}
          </p>
        </div>
      </div>

      {canSeePriceRequests ? (
        <Link
          href="/cashier"
          className={
            "inline-flex h-9 w-full items-center justify-center rounded-md px-3 text-xs font-semibold transition " +
            (hasPending
              ? "bg-odoo-danger text-white hover:bg-odoo-danger-dark"
              : "border border-odoo-border bg-white text-odoo-text-strong hover:bg-odoo-surface-muted")
          }
        >
          {hasPending ? "ໄປອະນຸມັດ" : "ເບິ່ງປະຫວັດ"}
        </Link>
      ) : (
        <div className="rounded-md border border-odoo-border bg-white px-3 py-2 text-[10px] font-semibold text-odoo-text-muted">
          ອະນຸມັດແລ້ວມື້ນີ້:{" "}
          <span className="text-odoo-text-strong">{approvedPricesToday}</span>
        </div>
      )}
    </section>
  );
}

function LauncherButton({
  href,
  label,
  icon,
  accent,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  accent: AccentName;
}) {
  const c = ACCENTS[accent];
  return (
    <Link
      href={href}
      className="group flex min-h-24 flex-col justify-between rounded-xl border border-odoo-border bg-white p-4 shadow-sm transition-all duration-300 hover:scale-[1.03] hover:shadow-md hover:border-odoo-primary-light"
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-md ${c.soft}`}>
        {icon}
      </span>
      <span className="mt-3 text-xs font-semibold text-odoo-text-strong group-hover:text-odoo-primary">
        {label}
      </span>
    </Link>
  );
}

function MobileLauncher({
  href,
  label,
  icon,
  accent,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  accent: AccentName;
}) {
  const c = ACCENTS[accent];
  // Compact pill: icon + label on one row.
  return (
    <Link
      href={href}
      className="flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-odoo-border bg-white px-2 py-1.5 shadow-sm active:scale-95"
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${c.soft} [&_svg]:h-4 [&_svg]:w-4`}>
        {icon}
      </span>
      <span className="truncate text-[11px] font-bold text-odoo-text-strong">{label}</span>
    </Link>
  );
}

function getBezierPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cpX1 = p0.x + (p1.x - p0.x) / 2;
    const cpY1 = p0.y;
    const cpX2 = p0.x + (p1.x - p0.x) / 2;
    const cpY2 = p1.y;
    d += ` C ${cpX1.toFixed(1)} ${cpY1.toFixed(1)}, ${cpX2.toFixed(1)} ${cpY2.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function getAreaBezierPath(
  points: Array<{ x: number; y: number }>,
  height: number,
  padY: number
) {
  const linePath = getBezierPath(points);
  if (!linePath) return "";
  return `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - padY} L ${points[0].x.toFixed(1)} ${height - padY} Z`;
}

function AreaChart({
  series,
}: {
  series: Array<{
    iso: string;
    date: Date;
    total: number;
    orders: number;
    isToday: boolean;
  }>;
}) {
  const width = 700;
  const height = 184;
  const padX = 28;
  const padY = 24;
  const maxTotal = Math.max(1, ...series.map((d) => d.total));
  const stepX = (width - padX * 2) / Math.max(1, series.length - 1);

  const points = series.map((d, i) => {
    const x = padX + i * stepX;
    const y = padY + (height - padY * 2) * (1 - d.total / maxTotal);
    return { x, y, ...d };
  });

  const linePath = getBezierPath(points);
  const areaPath = getAreaBezierPath(points, height, padY);

  return (
    <div className="overflow-hidden rounded-xl border border-odoo-border bg-white shadow-sm">
      <svg
        viewBox={`0 0 ${width} ${height + 26}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="dashboard-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--odoo-primary)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--odoo-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((t) => {
          const y = padY + (height - padY * 2) * t;
          return (
            <line
              key={t}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          );
        })}

        <path d={areaPath} fill="url(#dashboard-area-grad)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--odoo-primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p) => (
          <g key={p.iso}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.isToday ? 4.8 : 3.6}
              fill="#ffffff"
              stroke={p.isToday ? "var(--odoo-primary)" : "#94a3b8"}
              strokeWidth={p.isToday ? 3 : 2}
            />
            <text
              x={p.x}
              y={p.y - 11}
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill={p.isToday ? "var(--odoo-primary)" : "#64748b"}
            >
              {p.total > 0 ? compactMoneyFmt.format(p.total) : ""}
            </text>
            <text
              x={p.x}
              y={height + 12}
              textAnchor="middle"
              fontSize="9.5"
              fontWeight={p.isToday ? "800" : "600"}
              fill={p.isToday ? "var(--odoo-primary)" : "#64748b"}
            >
              {dayShortFmt.format(p.date)}
            </text>
            <title>
              {`${dayShortFmt.format(p.date)} · ${moneyFmt.format(p.total)} ບາດ · ${p.orders} ບິນ`}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-odoo-border bg-odoo-surface-muted py-8 text-center text-[11px] font-semibold text-odoo-text-muted">
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: number | null }) {
  if (status === 1) {
    return (
      <span className="mt-1 inline-flex rounded-full bg-odoo-success-bg px-2 py-0.5 text-[9px] font-bold text-odoo-success-text">
        ສຳເລັດ
      </span>
    );
  }
  if (status === 2) {
    return (
      <span className="mt-1 inline-flex rounded-full bg-odoo-danger-bg px-2 py-0.5 text-[9px] font-bold text-odoo-danger-text">
        ຍົກເລີກ
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex rounded-full bg-odoo-warning-bg px-2 py-0.5 text-[9px] font-bold text-odoo-warning-text">
      ລໍຖ້າ
    </span>
  );
}

function statusDotBg(status: number | null) {
  return status === 1
    ? "bg-odoo-success"
    : status === 2
      ? "bg-odoo-danger"
      : "bg-odoo-warning";
}

function rankBadgeClass(i: number) {
  if (i === 0) return "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-yellow-500 text-xs font-bold text-white shadow-md shadow-amber-500/20";
  if (i === 1) return "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-300 to-slate-400 text-xs font-bold text-white shadow-md shadow-slate-400/20";
  if (i === 2) return "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-amber-600 text-xs font-bold text-white shadow-md shadow-orange-500/20";
  return "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-xs font-bold text-slate-600 border border-slate-200";
}

function rankBarClass(i: number) {
  if (i === 0) return "h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 shadow-[0_0_8px_rgba(245,158,11,0.2)]";
  if (i === 1) return "h-full rounded-full bg-gradient-to-r from-slate-300 to-slate-500";
  if (i === 2) return "h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-600";
  return "h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600";
}

function SalesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 4 4 5-6" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2z" />
      <path d="M8 7h8M8 12h8M8 17h5" />
    </svg>
  );
}

function CashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}

function PosIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4 4h16v5H4z" />
      <path d="M4 9v11h16V9" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h8" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}
