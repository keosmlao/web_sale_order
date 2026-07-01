import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type IncentiveRow = {
  employee_code: string;
  display_name: string | null;
  group_code: string;
  sold_qty: string | number | null;
  sales_amount: string | number | null;
  hisense_sales: string | number | null;
  normal_bonus: string | number | null;
  target_per_person: string | number | null;
};

type RewardRow = {
  reward_code: string;
  group_code: string;
  brand_code: string | null;
  target_amount: string | number;
  reward_amount: string | number;
  split_by_share: boolean;
};

type ConfigRow = {
  currency_code: string;
  low_max_pct: string | number;
  standard_max_pct: string | number;
  low_multiplier: string | number;
  standard_multiplier: string | number;
  high_multiplier: string | number;
};

const number = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

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

  const current = currentVientianePeriod();
  const url = new URL(request.url);
  const yearRaw = Number(url.searchParams.get("year"));
  const monthRaw = Number(url.searchParams.get("month"));
  const year = Number.isInteger(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100
    ? yearRaw
    : current.year;
  const month = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12
    ? monthRaw
    : current.month;

  try {
    const [configRows, rewardRows, rows] = await Promise.all([
      prisma.$queryRaw<ConfigRow[]>`
        SELECT currency_code, low_max_pct, standard_max_pct,
               low_multiplier, standard_multiplier, high_multiplier
        FROM app_incentive_config WHERE id = 1
      `,
      prisma.$queryRaw<RewardRow[]>`
        SELECT reward_code, group_code, brand_code, target_amount, reward_amount, split_by_share
        FROM app_incentive_special_reward WHERE is_active
      `,
      prisma.$queryRaw<IncentiveRow[]>`
        WITH lines AS (
          SELECT
            s.salename,
            s.group_code,
            s.pcat,
            s.qty,
            s.sales_amount,
            s.brand,
            ps.status_code AS status_code,
            -- Design dimension (workbook Bonus_Maps). SDA=subtype, Air=inverter/on-off,
            -- Washer=dryer override else load type, REF=door type, AV=n/a.
            CASE s.pcat
              WHEN 'SDA' THEN s.sda_subtype
              WHEN 'Air' THEN CASE WHEN s.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
              WHEN 'AV'  THEN ''
              WHEN 'Washer' THEN CASE WHEN s.item_name ~* 'dryer|ອົບ'
                                      THEN 'Dryer' ELSE COALESCE(dtok.design_token, '') END
              ELSE COALESCE(dtok.design_token, '')
            END AS design_token,
            -- Size dimension. REF=cuft, Washer=kg, TV(008)=inch from size_name;
            -- Air/AV-audio=price band (THB 10k/20k), SDA=price band (500/1k/2k/5k).
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
            -- Walk-in / front-store sales only (ar_group 101 = "ຂາຍໜ້າຮ້ານ"), matching the
            -- workbook, which excludes wholesale/project. odg_sale_detail is the same
            -- denormalized table the workbook's "sale" sheet is exported from. Any category
            -- not explicitly mapped defaults to SDA/OTH (the workbook's catch-all bucket);
            -- brand gating in the point map keeps non-bonus items at zero.
            SELECT
              sd.salename, sd.qty, sd.sum_amount AS sales_amount, sd.price, sd.item_name,
              sd.item_category, sd.design_name, sd.size_name, sd.item_code,
              UPPER(COALESCE(sd.item_brand, '')) AS brand,
              COALESCE(cat.pointmap_category, 'SDA') AS pcat,
              COALESCE(cat.sda_subtype, 'OTH') AS sda_subtype,
              COALESCE(cat.group_code, 'CE_SDA') AS group_code
            FROM odg_sale_detail sd
            LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
            WHERE sd.branch_code = '01'
              AND sd.argroup_main = '101'
              AND sd.doc_date >= make_date(${year}, ${month}, 1)
              AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
              AND COALESCE(cat.is_active, true)
          ) s
          LEFT JOIN app_incentive_design_token dtok ON dtok.design_name = s.design_name
          LEFT JOIN app_incentive_size_token stok ON stok.size_name = s.size_name
          LEFT JOIN app_incentive_product_status ps ON ps.item_code = s.item_code
        ),
        sold AS (
          SELECT
            l.salename,
            l.group_code,
            l.brand,
            l.qty,
            l.sales_amount,
            COALESCE(pm.points, 0)
              * cfg.base_amount
              * COALESCE(sm.multiplier, 1)
              * l.qty AS line_bonus
          FROM lines l
          CROSS JOIN app_incentive_config cfg
          LEFT JOIN app_incentive_point_map pm
            ON pm.category_code = l.pcat
           AND pm.brand_code = l.brand
           AND pm.design_token = l.design_token
           AND pm.size_token = l.size_token
          LEFT JOIN app_incentive_status_multiplier sm ON sm.status_code = l.status_code
        ),
        by_emp AS (
          -- Aggregate each person's walk-in sales/bonus, resolving salename -> employee_code
          -- (alias first for SML spelling variants, then exact roster-name match).
          SELECT
            emp.employee_code,
            sold.group_code,
            SUM(sold.qty) AS sold_qty,
            SUM(sold.sales_amount) AS sales_amount,
            SUM(sold.sales_amount) FILTER (WHERE sold.brand = 'HISENSE') AS hisense_sales,
            SUM(sold.line_bonus) AS normal_bonus
          FROM sold
          LEFT JOIN LATERAL (
            SELECT employee_code FROM (
              SELECT alias.employee_code, 0 AS priority
              FROM app_incentive_sale_alias alias WHERE alias.salename = sold.salename
              UNION ALL
              SELECT e.employee_code, 1 AS priority
              FROM odg_employee e WHERE e.fullname_lo = sold.salename
            ) resolved
            ORDER BY priority, employee_code
            LIMIT 1
          ) emp ON true
          WHERE sold.salename IS NOT NULL AND sold.salename <> '' AND emp.employee_code IS NOT NULL
          GROUP BY emp.employee_code, sold.group_code
        ),
        roster AS (
          -- The authoritative front-store roster: everyone with a target for this month.
          -- product_group AC -> AIR group, CE -> CE_SDA group. Everyone on the roster is shown,
          -- with zero sales/bonus for anyone who has not sold yet this month.
          SELECT DISTINCT ON (t.emp_code, t.group_code)
            t.emp_code AS employee_code, t.group_code, t.target
          FROM (
            SELECT emp_code, target, roworder,
              CASE WHEN product_group = 'AC' THEN 'AIR' ELSE 'CE_SDA' END AS group_code
            FROM odg_retail_target_employee
            WHERE year = ${year.toString()}
              AND LPAD(month, 2, '0') = LPAD(${month.toString()}, 2, '0')
          ) t
          ORDER BY t.emp_code, t.group_code, t.roworder DESC
        )
        SELECT
          roster.employee_code,
          COALESCE(NULLIF(emp.fullname_lo, ''), NULLIF(emp.nickname, ''), roster.employee_code) AS display_name,
          roster.group_code,
          COALESCE(by_emp.sold_qty, 0) AS sold_qty,
          COALESCE(by_emp.sales_amount, 0) AS sales_amount,
          COALESCE(by_emp.hisense_sales, 0) AS hisense_sales,
          COALESCE(by_emp.normal_bonus, 0) AS normal_bonus,
          COALESCE(roster.target, 0) AS target_per_person
        FROM roster
        LEFT JOIN by_emp
          ON by_emp.employee_code = roster.employee_code AND by_emp.group_code = roster.group_code
        LEFT JOIN odg_employee emp ON emp.employee_code = roster.employee_code
        ORDER BY sales_amount DESC
      `,
    ]);

    const config = configRows[0] ?? {
      currency_code: "THB",
      low_max_pct: 0.5,
      standard_max_pct: 1,
      low_multiplier: 0.8,
      standard_multiplier: 1,
      high_multiplier: 1.1,
    };
    const lowMax = number(config.low_max_pct);
    const standardMax = number(config.standard_max_pct);

    const mapped = rows.map((row) => {
      const salesAmount = number(row.sales_amount);
      const targetPerPerson = number(row.target_per_person);
      const achievementPct = targetPerPerson > 0 ? salesAmount / targetPerPerson : 0;
      const multiplier = achievementPct <= lowMax
        ? number(config.low_multiplier)
        : achievementPct <= standardMax
          ? number(config.standard_multiplier)
          : number(config.high_multiplier);
      const normalBonus = number(row.normal_bonus);
      return {
        employeeCode: row.employee_code,
        displayName: row.display_name ?? row.employee_code,
        groupCode: row.group_code,
        soldQty: number(row.sold_qty),
        salesAmount,
        hisenseSales: number(row.hisense_sales),
        targetPerPerson,
        achievementPct,
        normalBonus,
        multiplier,
        netBonus: normalBonus * multiplier,
        specialReward: 0,
        totalPay: normalBonus * multiplier,
      };
    });

    // Special department rewards (workbook "② ເງິນພິເສດ"). Each active reward pays out only if
    // the department's qualifying walk-in total reaches its target. brand_code-scoped rewards
    // (e.g. HISENSE) qualify on that brand's sales; split_by_share divides the pot by each
    // person's share of those sales, otherwise it is a flat amount per person in the group.
    for (const reward of rewardRows) {
      const group = reward.group_code;
      const inGroup = mapped.filter((row) => row.groupCode === group);
      if (inGroup.length === 0) continue;
      const qualifyingOf = (row: (typeof mapped)[number]) =>
        reward.brand_code === "HISENSE" ? row.hisenseSales : row.salesAmount;
      const deptTotal = inGroup.reduce((sum, row) => sum + qualifyingOf(row), 0);
      if (deptTotal < number(reward.target_amount)) continue;
      const rewardAmount = number(reward.reward_amount);
      for (const row of inGroup) {
        const pay = reward.split_by_share
          ? (deptTotal > 0 ? rewardAmount * (qualifyingOf(row) / deptTotal) : 0)
          : rewardAmount;
        row.specialReward += pay;
        row.totalPay += pay;
      }
    }

    return NextResponse.json({
      year,
      month,
      currencyCode: config.currency_code,
      tiers: {
        lowMaxPct: lowMax,
        standardMaxPct: standardMax,
        lowMultiplier: number(config.low_multiplier),
        standardMultiplier: number(config.standard_multiplier),
        highMultiplier: number(config.high_multiplier),
      },
      rows: mapped,
      totalSales: mapped.reduce((sum, row) => sum + row.salesAmount, 0),
      totalBonus: mapped.reduce((sum, row) => sum + row.netBonus, 0),
      totalSpecial: mapped.reduce((sum, row) => sum + row.specialReward, 0),
      totalPay: mapped.reduce((sum, row) => sum + row.totalPay, 0),
    });
  } catch (error) {
    console.error("GET /api/reports/incentives failed", error);
    return NextResponse.json(
      { error: "Incentive tables are not installed. Run sql/add-sales-incentive.sql first." },
      { status: 503 },
    );
  }
}
