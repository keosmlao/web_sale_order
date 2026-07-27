import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import {
  EXCLUDED_DOC_FORMATS,
  EXCLUDED_SALE_GROUP,
  TARGET_ITEM_MAIN_GROUPS,
} from "@/lib/sales-scope";

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

// One row per (unit reward, roster member): the member's qualifying unit
// count. Workbook ④/⑤ — per-unit tiered spiffs on each person's OWN count.
type UnitRewardMemberRow = {
  reward_code: string;
  description: string;
  group_code: string;
  brand_code: string | null;
  item_match: string | null;
  low_min_qty: string | number;
  low_reward: string | number;
  high_min_qty: string | number | null;
  high_reward: string | number | null;
  is_active: boolean;
  emp_code: string | null;
  emp_name: string | null;
  units: string | number | null;
};

type DepartmentTotalRow = {
  sales_amount: string | number | null;
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

  // The department total is compared against the monthly retail target, so it
  // has to be scoped exactly like the branch's own sales workbook — target
  // product groups only, storefront channel only. See @/lib/sales-scope.
  const targetGroups = Prisma.join([...TARGET_ITEM_MAIN_GROUPS]);
  const excludedDocFormats = Prisma.join([...EXCLUDED_DOC_FORMATS]);

  try {
    const [rows, unitRows, departmentTotalRows] = await Promise.all([
      prisma.$queryRaw<RewardMemberRow[]>`
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
      LEFT JOIN roster r ON rw.group_code = 'ALL' OR r.group_code = rw.group_code
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
      WHERE rw.effective_from < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
        AND rw.effective_to >= make_date(${year}, ${month}, 1)
      ORDER BY rw.reward_code, amount DESC
    `,
      // Unit-count spiffs (workbook ④/⑤) — per person, tiered per-unit pay.
      // Best-effort: table ships in sql/add-incentive-unit-reward.sql.
      prisma.$queryRaw<UnitRewardMemberRow[]>`
      WITH roster AS (
        SELECT DISTINCT ON (t.emp_code)
          t.emp_code,
          CASE WHEN t.product_group = 'AC' THEN 'AIR' ELSE 'CE_SDA' END AS group_code
        FROM odg_retail_target_employee t
        WHERE t.year = ${year.toString()}
          AND LPAD(t.month, 2, '0') = LPAD(${month.toString()}, 2, '0')
        ORDER BY t.emp_code, t.roworder DESC
      ),
      names AS (
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
        ur.reward_code,
        ur.description,
        ur.group_code,
        ur.brand_code,
        ur.item_match,
        ur.low_min_qty,
        ur.low_reward,
        ur.high_min_qty,
        ur.high_reward,
        ur.is_active,
        r.emp_code,
        COALESCE(NULLIF(e.fullname_lo, ''), NULLIF(e.nickname, ''), r.emp_code) AS emp_name,
        COALESCE(s.units, 0) AS units
      FROM app_incentive_unit_reward ur
      LEFT JOIN roster r ON r.group_code = ur.group_code
      LEFT JOIN odg_employee e ON e.employee_code = r.emp_code
      LEFT JOIN LATERAL (
        -- This member's qualifying SETS. A split-type AC is two lines —
        -- "… [C]" indoor + "… [H]" outdoor — so the outdoor [H] line is
        -- excluded to count each set once. brand_code scopes to the AIR
        -- point-map category of that brand; item_match matches a pushed
        -- model by item_code or item_name.
        SELECT SUM(sd.qty) AS units
        FROM odg_sale_detail sd
        JOIN names n ON n.salename = sd.salename
        LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
        WHERE n.emp_code = r.emp_code
          AND sd.branch_code = '01'
          AND sd.argroup_main = '101'
          AND sd.doc_date >= make_date(${year}, ${month}, 1)
          AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
          AND sd.item_name !~ '\\[H\\]\\s*$'
          AND (
            CASE
              WHEN COALESCE(ur.item_match, '') <> '' THEN
                sd.item_code = ur.item_match OR sd.item_name ILIKE '%' || ur.item_match || '%'
              ELSE
                COALESCE(cat.pointmap_category, '') = 'Air'
                AND UPPER(COALESCE(sd.item_brand, '')) = UPPER(COALESCE(ur.brand_code, ''))
            END
          )
      ) s ON true
      WHERE ur.effective_from < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
        AND ur.effective_to >= make_date(${year}, ${month}, 1)
      ORDER BY ur.reward_code, units DESC
    `.catch(() => [] as UnitRewardMemberRow[]),
      prisma.$queryRaw<DepartmentTotalRow[]>`
      SELECT COALESCE(SUM(sd.sum_amount), 0) AS sales_amount
      FROM odg_sale_detail sd
      LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
      WHERE sd.branch_code = '01'
        AND sd.argroup_main = '101'
        AND sd.itemmaingroup IN (${targetGroups})
        AND COALESCE(sd.sale_group_name, '') <> ${EXCLUDED_SALE_GROUP}
        AND sd.doc_format_code NOT IN (${excludedDocFormats})
        AND sd.doc_date >= make_date(${year}, ${month}, 1)
        AND sd.doc_date < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
        AND COALESCE(cat.is_active, true)
        AND sd.item_code NOT LIKE '97%'
    `,
    ]);

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
      const memberCurrent = members.reduce((sum, m) => sum + m.amount, 0);
      const current = meta.group_code === "ALL" && !meta.brand_code
        ? number(departmentTotalRows[0]?.sales_amount)
        : memberCurrent;
      const mine = members.find((m) => m.code === myCode)?.amount ?? 0;
      // Whether the caller belongs to this reward's target roster — i.e. they
      // received the matching monthly target (AC target → AIR rewards like
      // MITSUBISHI; CE/FZ target → CE_SDA rewards). Non-privileged staff only
      // see rewards they're eligible for; managers / heads see them all.
      const mineEligible = members.some((m) => m.code === myCode);
      // A member's slice of the department total — for split_by_share rewards
      // this is exactly the share of the pot they would be paid.
      const shareOf = (amount: number) => (memberCurrent > 0 ? amount / memberCurrent : 0);
      return {
        code: meta.reward_code,
        description: meta.description,
        brandCode: meta.brand_code || null,
        target,
        reward,
        splitByShare: meta.split_by_share,
        current,
        mine,
        mineEligible,
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

    // Unit-count spiffs — resolve each member's tier from their OWN count.
    const unitByReward = new Map<string, UnitRewardMemberRow[]>();
    for (const row of unitRows) {
      const list = unitByReward.get(row.reward_code);
      if (list) list.push(row);
      else unitByReward.set(row.reward_code, [row]);
    }

    const unitRewards = Array.from(unitByReward.values()).map((memberRows) => {
      const meta = memberRows[0];
      const lowMin = number(meta.low_min_qty);
      const lowReward = number(meta.low_reward);
      const highMin = meta.high_min_qty === null ? 0 : number(meta.high_min_qty);
      const highReward = number(meta.high_reward);
      // Reach the high threshold → EVERY unit pays the high rate; otherwise
      // the low threshold → every unit pays the low rate; below it → nothing.
      const payFor = (units: number) => {
        if (highMin > 0 && units >= highMin) return { tier: "high" as const, pay: units * highReward };
        if (lowMin > 0 && units >= lowMin) return { tier: "low" as const, pay: units * lowReward };
        return { tier: "none" as const, pay: 0 };
      };
      const members = memberRows
        .filter((row) => row.emp_code !== null)
        .map((row) => {
          const units = number(row.units);
          return { code: row.emp_code!, name: row.emp_name ?? row.emp_code!, units, ...payFor(units) };
        });
      const mine = members.find((m) => m.code === myCode);
      return {
        code: meta.reward_code,
        description: meta.description,
        brandCode: meta.brand_code || null,
        itemMatch: meta.item_match || null,
        lowMinQty: lowMin,
        lowReward,
        highMinQty: highMin,
        highReward,
        totalUnits: members.reduce((sum, m) => sum + m.units, 0),
        people: members.length,
        mine: mine?.units ?? 0,
        myTier: mine?.tier ?? "none",
        myReward: mine?.pay ?? 0,
        // Caller is on this reward's target roster (received the AC / CE·FZ
        // target). Non-privileged staff only see rewards they're eligible for.
        mineEligible: mine !== undefined,
        // Full per-person breakdown — managers / unit heads only.
        breakdown: seesEveryone ? members : undefined,
      };
    });

    // Managers / heads see every announced program; a regular salesperson only
    // sees rewards for the target group they were assigned this month — so an
    // AC-brand spiff (MITSUBISHI) no longer shows to staff without an AC target.
    const visibleForCaller = <T extends { mineEligible: boolean }>(list: T[]) =>
      seesEveryone ? list : list.filter((r) => r.mineEligible);

    return NextResponse.json({
      year,
      month,
      rewards: visibleForCaller(rewards),
      unitRewards: visibleForCaller(unitRewards),
    });
  } catch (error) {
    console.error("GET /api/reports/special-rewards failed", error);
    // Table not installed — the home card simply hides.
    return NextResponse.json({ rewards: [], unitRewards: [] });
  }
}
