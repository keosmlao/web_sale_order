import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Special department rewards (workbook "🎁 ລາງວັນພິເສດ") with the department's
// live month-to-date progress toward each target. The home page shows every
// configured reward as the month's announced program — is_active only controls
// whether the incentives report PAYS it (see settings → incentives).
//
// One row per (reward, roster member): the member's own qualifying sales this
// month. Aggregates (department total, caller's share) are assembled in JS;
// the full per-person breakdown is returned only to managers / unit heads.
type RewardMemberRow = {
  reward_code: string;
  description: string;
  group_code: string;
  brand_code: string | null;
  target_amount: string | number;
  reward_amount: string | number;
  split_by_share: boolean;
  is_active: boolean;
  emp_code: string | null;
  emp_name: string | null;
  amount: string | number | null;
};

const number = (value: string | number | bigint | null | undefined) =>
  Number(value ?? 0) || 0;

function currentVientianePeriod(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const myCode = employee.employeeCode ?? "";
  const role = roleFromEmployee(employee);
  const seesEveryone = role === "manager" || role === "head";

  // ?year=&month= lets the report page browse past months; defaults to the
  // current Vientiane period (used by the home card).
  const current = currentVientianePeriod();
  const url = new URL(request.url);
  const yr = Number(url.searchParams.get("year"));
  const mo = Number(url.searchParams.get("month"));
  const year = Number.isInteger(yr) && yr >= 2020 && yr <= 2100 ? yr : current.year;
  const month = Number.isInteger(mo) && mo >= 1 && mo <= 12 ? mo : current.month;

  try {
    const rows = await prisma.$queryRaw<RewardMemberRow[]>`
      WITH roster AS (
        -- This month's target roster, one row per person, grouped the same way
        -- as the incentives report (product_group AC -> AIR, everything else
        -- -> CE_SDA).
        SELECT DISTINCT ON (t.emp_code)
          t.emp_code,
          CASE WHEN t.product_group = 'AC' THEN 'AIR' ELSE 'CE_SDA' END AS group_code
        FROM odg_retail_target_employee t
        WHERE t.year = ${year.toString()}
          AND LPAD(t.month, 2, '0') = LPAD(${month.toString()}, 2, '0')
        ORDER BY t.emp_code, t.roworder DESC
      ),
      names AS (
        -- Roster employee -> the salenames their odg_sale_detail rows carry
        -- (roster fullname_lo + SML spelling aliases).
        SELECT r.emp_code, e.fullname_lo AS salename
        FROM roster r
        JOIN odg_employee e ON e.employee_code = r.emp_code
        WHERE COALESCE(e.fullname_lo, '') <> ''
        UNION
        SELECT r.emp_code, a.salename
        FROM roster r
        JOIN app_incentive_sale_alias a ON a.employee_code = r.emp_code
      )
      SELECT
        rw.reward_code,
        rw.description,
        rw.group_code,
        rw.brand_code,
        rw.target_amount,
        rw.reward_amount,
        rw.split_by_share,
        rw.is_active,
        r.emp_code,
        COALESCE(NULLIF(e.fullname_lo, ''), NULLIF(e.nickname, ''), r.emp_code) AS emp_name,
        COALESCE(s.amount, 0) AS amount
      FROM app_incentive_special_reward rw
      LEFT JOIN roster r ON r.group_code = rw.group_code
      LEFT JOIN odg_employee e ON e.employee_code = r.emp_code
      LEFT JOIN LATERAL (
        -- This member's month-to-date walk-in sales, optionally restricted to
        -- the reward's brand (e.g. HISENSE) — the same qualifying rule the
        -- incentives report pays on.
        SELECT SUM(sd.sum_amount) AS amount
        FROM odg_sale_detail sd
        JOIN names n ON n.salename = sd.salename
        WHERE n.emp_code = r.emp_code
          AND sd.branch_code = '01'
          AND sd.argroup_main = '101'
          AND sd.doc_date >= make_date(${year}, ${month}, 1)
          AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
          AND (
            COALESCE(rw.brand_code, '') = ''
            OR UPPER(COALESCE(sd.item_brand, '')) = UPPER(rw.brand_code)
          )
      ) s ON true
      ORDER BY rw.reward_code, amount DESC
    `;

    // Assemble per-reward aggregates from the member rows.
    const byReward = new Map<string, RewardMemberRow[]>();
    for (const row of rows) {
      const list = byReward.get(row.reward_code);
      if (list) list.push(row);
      else byReward.set(row.reward_code, [row]);
    }

    const rewards = Array.from(byReward.values()).map((memberRows) => {
      const meta = memberRows[0];
      const target = number(meta.target_amount);
      const reward = number(meta.reward_amount);
      const members = memberRows
        .filter((row) => row.emp_code !== null)
        .map((row) => ({ code: row.emp_code!, name: row.emp_name ?? row.emp_code!, amount: number(row.amount) }));
      const current = members.reduce((sum, m) => sum + m.amount, 0);
      const mine = members.find((m) => m.code === myCode)?.amount ?? 0;
      // A member's slice of the department total — for split_by_share rewards
      // this is exactly the share of the pot they would be paid.
      const shareOf = (amount: number) => (current > 0 ? amount / current : 0);
      return {
        code: meta.reward_code,
        description: meta.description,
        brandCode: meta.brand_code || null,
        target,
        reward,
        splitByShare: meta.split_by_share,
        current,
        mine,
        myShare: shareOf(mine),
        myReward: meta.split_by_share ? reward * shareOf(mine) : reward,
        people: members.length,
        achieved: target > 0 && current >= target,
        pct: target > 0 ? current / target : 0,
        // Full per-person breakdown — managers / unit heads only.
        breakdown: seesEveryone
          ? members.map((m) => ({
              code: m.code,
              name: m.name,
              amount: m.amount,
              share: shareOf(m.amount),
              reward: meta.split_by_share ? reward * shareOf(m.amount) : reward,
            }))
          : undefined,
      };
    });

    return NextResponse.json({ year, month, rewards });
  } catch (error) {
    console.error("GET /api/reports/special-rewards failed", error);
    // Table not installed — the home card simply hides.
    return NextResponse.json({ rewards: [] });
  }
}
