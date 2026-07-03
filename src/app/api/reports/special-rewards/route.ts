import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Special department rewards (workbook "🎁 ລາງວັນພິເສດ") with the department's
// live month-to-date progress toward each target. The home page shows every
// configured reward as the month's announced program — is_active only controls
// whether the incentives report PAYS it (see settings → incentives).
type RewardProgressRow = {
  reward_code: string;
  description: string;
  group_code: string;
  brand_code: string | null;
  target_amount: string | number;
  reward_amount: string | number;
  split_by_share: boolean;
  is_active: boolean;
  current_amount: string | number | null;
  my_amount: string | number | null;
  people: bigint | number | null;
};

const number = (value: string | number | bigint | null | undefined) =>
  Number(value ?? 0) || 0;

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const myCode = employee.employeeCode ?? "";

  try {
    const rows = await prisma.$queryRaw<RewardProgressRow[]>`
      WITH roster AS (
        -- This month's target roster, one row per person, grouped the same way
        -- as the incentives report (product_group AC -> AIR, everything else
        -- -> CE_SDA).
        SELECT DISTINCT ON (t.emp_code)
          t.emp_code,
          CASE WHEN t.product_group = 'AC' THEN 'AIR' ELSE 'CE_SDA' END AS group_code
        FROM odg_retail_target_employee t
        WHERE t.year = to_char(CURRENT_DATE, 'YYYY')
          AND LPAD(t.month, 2, '0') = to_char(CURRENT_DATE, 'MM')
        ORDER BY t.emp_code, t.roworder DESC
      ),
      names AS (
        -- Roster employee -> the salenames their odg_sale_detail rows carry
        -- (roster fullname_lo + SML spelling aliases).
        SELECT r.group_code, e.fullname_lo AS salename
        FROM roster r
        JOIN odg_employee e ON e.employee_code = r.emp_code
        WHERE COALESCE(e.fullname_lo, '') <> ''
        UNION
        SELECT r.group_code, a.salename
        FROM roster r
        JOIN app_incentive_sale_alias a ON a.employee_code = r.emp_code
      ),
      members AS (
        SELECT group_code, COUNT(*)::bigint AS people FROM roster GROUP BY group_code
      ),
      my_names AS (
        -- The caller's own salenames, to split out their personal share.
        SELECT fullname_lo AS salename FROM odg_employee
        WHERE employee_code = ${myCode} AND COALESCE(fullname_lo, '') <> ''
        UNION
        SELECT salename FROM app_incentive_sale_alias WHERE employee_code = ${myCode}
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
        COALESCE(s.amount, 0) AS current_amount,
        COALESCE(s.my_amount, 0) AS my_amount,
        COALESCE(m.people, 0) AS people
      FROM app_incentive_special_reward rw
      LEFT JOIN members m ON m.group_code = rw.group_code
      LEFT JOIN LATERAL (
        -- Month-to-date walk-in sales of the reward's group, optionally
        -- restricted to the reward's brand (e.g. HISENSE) — the same
        -- qualifying rule the incentives report pays on.
        SELECT SUM(sd.sum_amount) AS amount,
               SUM(sd.sum_amount) FILTER (
                 WHERE sd.salename IN (SELECT salename FROM my_names)
               ) AS my_amount
        FROM odg_sale_detail sd
        JOIN names n ON n.salename = sd.salename
        WHERE n.group_code = rw.group_code
          AND sd.branch_code = '01'
          AND sd.argroup_main = '101'
          AND sd.doc_date >= date_trunc('month', CURRENT_DATE)
          AND sd.doc_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
          AND (
            COALESCE(rw.brand_code, '') = ''
            OR UPPER(COALESCE(sd.item_brand, '')) = UPPER(rw.brand_code)
          )
      ) s ON true
      ORDER BY rw.reward_code
    `;

    return NextResponse.json({
      rewards: rows.map((row) => {
        const target = number(row.target_amount);
        const current = number(row.current_amount);
        const reward = number(row.reward_amount);
        const mine = number(row.my_amount);
        // My slice of the department total — for split_by_share rewards this
        // is exactly the share of the pot I would be paid.
        const myShare = current > 0 ? mine / current : 0;
        return {
          code: row.reward_code,
          description: row.description,
          brandCode: row.brand_code || null,
          target,
          reward,
          splitByShare: row.split_by_share,
          current,
          mine,
          myShare,
          myReward: row.split_by_share ? reward * myShare : reward,
          people: number(row.people),
          achieved: target > 0 && current >= target,
          pct: target > 0 ? current / target : 0,
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/reports/special-rewards failed", error);
    // Table not installed — the home card simply hides.
    return NextResponse.json({ rewards: [] });
  }
}
