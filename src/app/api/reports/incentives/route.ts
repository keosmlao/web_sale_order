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
import { saleBasis } from "@/lib/sales-basis";
import { saleReportDate, saleReportMonth } from "@/lib/sale-month";

type IncentiveRow = {
  employee_code: string;
  display_name: string | null;
  group_code: string;
  sold_qty: string | number | null;
  sales_amount: string | number | null;
  hisense_sales: string | number | null;
  bonus_points: string | number | null;
  normal_bonus: string | number | null;
  target_per_person: string | number | null;
};

/**
 * Front-store (ຂາຍໜ້າຮ້ານ) rewards, kept in step with the management app's
 * retail-incentive report (odgmgt-next app/api/retail-incentive/route.js).
 *
 * The two read the same database and the same scheme tables, so a seller
 * opening this page and a manager opening that one have to arrive at the same
 * pay. The scoring query already agrees line for line; what used to differ was
 * the assembly on top of it, so the rules below are deliberately spelled the
 * same way as there:
 *
 *   pay per person = ໂບນັດຄະແນນ + ລາງວັນຕໍ່ຊຸດ + ຄ່າຄອມ
 *
 * ② ເງິນພິເສດ is NOT part of it. A department reward is one pot won by the
 * whole storefront, not an amount each person earns — paying it per head
 * multiplied a 1,000 reward into 15,000 and made this report read far above
 * the payout the branch actually approves.
 */
type RewardRow = {
  reward_code: string;
  description: string | null;
  group_code: string;
  target_amount: string | number;
  reward_amount: string | number;
  split_by_share: boolean;
};

// Where a row's ລາງວັນຕໍ່ຊຸດ came from. The figure is a sum of independent
// programmes, so without the parts a manager cannot check it or explain it to
// the person being paid.
type SpecialLine = {
  label: string;
  note: string;
  amount: number;
};

// One department programme (② ເງິນພິເສດ) and whether the storefront won it —
// the same shape the management app returns, so both screens can show the
// condition beside the result instead of a bare amount.
type SpecialReward = {
  code: string;
  description: string;
  groupCode: string;
  targetAmount: number;
  rewardAmount: number;
  splitByShare: boolean;
  achieved: boolean;
  actualAmount: number;
  achievementPct: number;
};

// Amounts inside the explanation strings — grouped, no decimals, so the note
// reads like the workbook rather than like a database value.
const fmt = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

type ConfigRow = {
  currency_code: string;
  low_max_pct: string | number;
  standard_max_pct: string | number;
  low_multiplier: string | number;
  standard_multiplier: string | number;
  high_multiplier: string | number;
  commission_base: string | number;
};

// Commission pay-rate (workbook "ຄ່າຄອມ ປະຈຳເດືອນ"): 0 below the minimum achievement,
// the achievement rounded DOWN to the step below the pivot, and rounded UP to the step
// at/above the pivot. Defaults (0.80 / 0.05 / 1.00) reproduce the original hard-coded
// rule; all three are configurable via app_incentive_config.
type CommissionRule = { minPct: number; step: number; pivotPct: number };
const DEFAULT_COMMISSION_RULE: CommissionRule = { minPct: 0.8, step: 0.05, pivotPct: 1 };

function commissionRateFor(achievementPct: number, rule: CommissionRule = DEFAULT_COMMISSION_RULE): number {
  if (achievementPct < rule.minPct) return 0;
  const step = rule.step > 0 ? rule.step : 0.05;
  // Snap tiny binary-float error (e.g. 1/0.05 = 19.999…) before floor/ceil so
  // exact multiples land on the intended bracket.
  const units = Math.round((achievementPct / step) * 1e6) / 1e6;
  return (achievementPct < rule.pivotPct ? Math.floor(units) : Math.ceil(units)) * step;
}

// Per-position tier model (app_incentive_commission_tier). A tier list is sorted
// ascending by fromPct; the active tier is the last one whose fromPct ≤ the
// achievement. Below the lowest tier → 0.
type CommissionTier = { fromPct: number; mode: "zero" | "round_down" | "round_up" | "exact"; roundStep: number };

function roundToStep(pct: number, step: number, up: boolean): number {
  const s = step > 0 ? step : 0.05;
  const units = Math.round((pct / s) * 1e6) / 1e6;
  return (up ? Math.ceil(units) : Math.floor(units)) * s;
}

// Resolve a pay rate from a position's tiers; falls back to the scalar rule when
// that position has no tiers configured (table missing / not yet migrated).
function rateFromTiers(achievementPct: number, tiers: CommissionTier[] | undefined, fallback: CommissionRule): number {
  if (!tiers || tiers.length === 0) return commissionRateFor(achievementPct, fallback);
  let active: CommissionTier | null = null;
  for (const t of tiers) {
    if (achievementPct >= t.fromPct) active = t;
    else break;
  }
  if (!active) return 0;
  switch (active.mode) {
    case "zero": return 0;
    case "exact": return achievementPct;
    case "round_up": return roundToStep(achievementPct, active.roundStep, true);
    case "round_down": return roundToStep(achievementPct, active.roundStep, false);
    default: return 0;
  }
}

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
    const [configRows, ruleRows, tierRows, rewardRows, roleCommRows, roleEmpRows, rows, unitRewardRows] = await Promise.all([
      prisma.$queryRaw<ConfigRow[]>`
        SELECT currency_code, low_max_pct, standard_max_pct,
               low_multiplier, standard_multiplier, high_multiplier, commission_base
        FROM app_incentive_config ORDER BY id LIMIT 1
      `,
      // Configurable commission-rate rule. Best-effort — columns ship in
      // sql/add-incentive-commission-rule.sql; falls back to the defaults
      // (0.80 / 0.05 / 1.00) until the migration is applied.
      prisma.$queryRaw<Array<{ commission_min_pct: string | number; commission_round_step: string | number; commission_pivot_pct: string | number }>>`
        SELECT commission_min_pct, commission_round_step, commission_pivot_pct
        FROM app_incentive_config ORDER BY id LIMIT 1
      `.catch(() => []),
      // Per-position commission tiers. Best-effort — ships in
      // sql/add-incentive-commission-tier.sql; empty array falls back to the
      // scalar min/step/pivot rule above.
      prisma.$queryRaw<Array<{ position_code: string; from_pct: string | number; mode: string; round_step: string | number }>>`
        SELECT position_code, from_pct, mode, round_step
        FROM app_incentive_commission_tier
        ORDER BY position_code, from_pct
      `.catch(() => []),
      // Department rewards in force for the month. Mid-month rather than any
      // overlap with it, exactly as the management report asks: a reward
      // written for one month is what that month pays, and an overlap test lets
      // a programme that ended on the 2nd, or starts on the 30th, pay a whole
      // month's pot.
      prisma.$queryRaw<RewardRow[]>`
        SELECT reward_code, description, group_code,
               target_amount, reward_amount, split_by_share
        FROM app_incentive_special_reward
        WHERE is_active
          AND make_date(${year}, ${month}, 15) BETWEEN effective_from AND effective_to
      `,
      // Manager / unit-head commission lines (workbook: per product group,
      // paid on the TEAM's achievement of that group). Best-effort — table
      // ships in sql/add-incentive-role-commission.sql.
      prisma.$queryRaw<Array<{ position_code: string; group_code: string; base_amount: string | number | null }>>`
        SELECT position_code, group_code, base_amount
        FROM app_incentive_role_commission
      `.catch(() => []),
      prisma.$queryRaw<Array<{ employee_code: string; fullname_lo: string | null; nickname: string | null; position_code: string }>>`
        SELECT employee_code, fullname_lo, nickname, position_code
        FROM odg_employee
        WHERE position_code IN ('11', '12')
          AND department_code = '205'
          AND COALESCE(employment_status, 'ACTIVE') = 'ACTIVE'
      `.catch(() => []),
      prisma.$queryRaw<IncentiveRow[]>`
        WITH lines AS (
          SELECT
            s.doc_date,
            s.salename,
            s.group_code,
            s.pcat,
            s.qty,
            s.sales_amount,
            s.brand,
            ${incentivePointQuantity("s", Prisma.sql`s.pcat`, Prisma.sql`s.has_mate`)} AS point_qty,
            ps.status_code AS status_code,
            -- Design dimension (workbook Bonus_Maps). SDA=subtype, Air=inverter/on-off,
            -- REF=door type and Washer=load type both from ic_design (Top/Front/Twin Tub);
            -- the workbook classifies wash-dry combos by their load type, NOT as "Dryer",
            -- so we must not tag them from the name. AV=n/a.
            CASE s.pcat
              WHEN 'SDA' THEN s.sda_subtype
              WHEN 'Air' THEN CASE WHEN s.item_name ~* 'invert' THEN 'Inverter' ELSE 'On-Off' END
              WHEN 'AV'  THEN ''
              ELSE COALESCE(dtok.design_token, '')
            END AS design_token,
            -- Size dimension. REF=cuft, Washer=kg, TV(008)=inch from size_name;
            -- Air/AV-audio=price band (THB 10k/20k), SDA=price band (500/1k/2k/5k).
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
            -- Walk-in / front-store sales only (ar_group 101 = "ຂາຍໜ້າຮ້ານ"), matching the
            -- workbook, which excludes wholesale/project. odg_sale_detail is the same
            -- denormalized table the workbook's "sale" sheet is exported from. Any category
            -- not explicitly mapped defaults to SDA/OTH (the workbook's catch-all bucket);
            -- brand gating in the point map keeps non-bonus items at zero.
            SELECT
              ${saleReportDate("sd")} AS doc_date, sd.doc_no, sd.salename, sd.qty, sd.sum_amount AS sales_amount, sd.price, sd.item_name,
              sd.item_category, sd.design_name, sd.size_name, sd.item_code,
              UPPER(COALESCE(sd.item_brand, '')) AS brand,
              cat.pointmap_category AS pcat,
              COALESCE(cat.sda_subtype, 'OTH') AS sda_subtype,
              COALESCE(cat.group_code, 'CE_SDA') AS group_code,
              ${incentiveBandPrice(
                "sd",
                Prisma.sql`cat.pointmap_category`,
              )} AS combo_price,
              -- Whether this component found its other half at all. Resolved
              -- here, where the columns the match correlates on are still in
              -- scope; the layer above only sees the answer.
              ${incentiveMatePrice("sd")} IS NOT NULL AS has_mate
            FROM odg_sale_detail sd
            LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
            WHERE ${saleBasis("sd")}
              AND ${saleReportMonth("sd", year, month)}
              AND COALESCE(cat.is_active, true)
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
        ),
        sold AS (
          SELECT
            l.salename,
            l.group_code,
            l.brand,
            l.qty,
            l.sales_amount,
            COALESCE(pm.points, 0) * COALESCE(sm.multiplier, 1) * l.point_qty AS line_points,
            COALESCE(pm.points, 0)
              * cfg.base_amount
              * COALESCE(sm.multiplier, 1)
              * l.point_qty AS line_bonus
          FROM lines l
          -- Pin the single config row. An unfiltered CROSS JOIN would duplicate
          -- every sale line once per config row, multiplying the whole
          -- department's bonus, the moment a second row is inserted.
          CROSS JOIN (SELECT base_amount FROM app_incentive_config ORDER BY id LIMIT 1) cfg
          -- Point map is defined per month with carry-forward: the newest
          -- effect_month <= the report month wins per combination.
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
        ),
        by_emp AS (
          -- Aggregate each person's walk-in sales/bonus, resolving salename -> employee_code
          -- (alias first for SML spelling variants, then exact roster-name match).
          -- Aggregate by salesperson only (not item category): every walk-in sale a person
          -- makes counts toward their department, matching the workbook. Otherwise an AIR
          -- seller's AC installation lines (empty item_category -> CE_SDA) would be split off
          -- and dropped because they have no CE target.
          SELECT
            emp.employee_code,
            MAX(sold.salename) AS sale_name,
            SUM(sold.qty) AS sold_qty,
            SUM(sold.sales_amount) AS sales_amount,
            SUM(sold.sales_amount) FILTER (WHERE sold.brand = 'HISENSE') AS hisense_sales,
            SUM(sold.line_points) AS bonus_points,
            SUM(sold.line_bonus) AS normal_bonus
          FROM sold
          -- btrim on both sides: the ERP stores some salenames with trailing
          -- spaces, and an exact match silently dropped those rows from the
          -- seller's bonus while the management report still counted them.
          LEFT JOIN LATERAL (
            SELECT employee_code FROM (
              SELECT alias.employee_code, 0 AS priority
              FROM app_incentive_sale_alias alias WHERE btrim(alias.salename) = btrim(sold.salename)
              UNION ALL
              SELECT e.employee_code, 1 AS priority
              FROM odg_employee e WHERE btrim(e.fullname_lo) = btrim(sold.salename)
            ) resolved
            ORDER BY priority, employee_code
            LIMIT 1
          ) emp ON true
          WHERE sold.salename IS NOT NULL AND sold.salename <> '' AND emp.employee_code IS NOT NULL
          GROUP BY emp.employee_code
        ),
        roster AS (
          -- The authoritative front-store roster: everyone with a target for this month,
          -- one row per person (product_group AC -> AIR group, CE -> CE_SDA group). Everyone
          -- is shown, with zero sales/bonus for anyone who has not sold yet this month.
          SELECT DISTINCT ON (t.emp_code)
            t.emp_code AS employee_code, t.group_code, t.target
          FROM (
            SELECT emp_code, target, roworder,
              CASE WHEN product_group = 'AC' THEN 'AIR' ELSE 'CE_SDA' END AS group_code
            FROM odg_retail_target_employee
            WHERE year = ${year.toString()}
              AND LPAD(month, 2, '0') = LPAD(${month.toString()}, 2, '0')
          ) t
          -- Storefront only: individual retail targets belong to department 205.
          JOIN odg_employee re ON re.employee_code = t.emp_code
            AND re.department_code = '205'
          ORDER BY t.emp_code, t.roworder DESC
        )
        SELECT
          roster.employee_code,
          COALESCE(NULLIF(emp.fullname_lo, ''), NULLIF(emp.nickname, ''),
                   by_emp.sale_name, roster.employee_code) AS display_name,
          roster.group_code,
          COALESCE(by_emp.sold_qty, 0) AS sold_qty,
          COALESCE(by_emp.sales_amount, 0) AS sales_amount,
          COALESCE(by_emp.hisense_sales, 0) AS hisense_sales,
          COALESCE(by_emp.bonus_points, 0) AS bonus_points,
          COALESCE(by_emp.normal_bonus, 0) AS normal_bonus,
          COALESCE(roster.target, 0) AS target_per_person
        FROM roster
        LEFT JOIN by_emp ON by_emp.employee_code = roster.employee_code
        LEFT JOIN odg_employee emp ON emp.employee_code = roster.employee_code
        -- A target of zero is not a target: the scheme pays against one, and a
        -- person carrying none has no achievement to be banded or paid on. The
        -- management report drops these rows, so their sales must not reach the
        -- department total here either, or the two disagree on whether the
        -- storefront won its monthly reward.
        WHERE COALESCE(roster.target, 0) > 0
        ORDER BY sales_amount DESC
      `,
      // Unit-count spiffs (workbook ④/⑤): active rewards with each roster
      // member's qualifying set count. A split AC = "… [C]" indoor + "… [H]"
      // outdoor lines, so [H] is excluded to count each set once.
      // Best-effort — table ships in sql/add-incentive-unit-reward.sql.
      prisma.$queryRaw<Array<{
        reward_code: string;
        description: string | null;
        low_min_qty: string | number;
        low_reward: string | number;
        high_min_qty: string | number | null;
        high_reward: string | number | null;
        emp_code: string;
        units: string | number | null;
      }>>`
        WITH roster AS (
          SELECT DISTINCT ON (t.emp_code)
            t.emp_code,
            CASE WHEN t.product_group = 'AC' THEN 'AIR' ELSE 'CE_SDA' END AS group_code
          FROM odg_retail_target_employee t
          -- Storefront only: individual retail targets belong to department 205.
          JOIN odg_employee re ON re.employee_code = t.emp_code
            AND re.department_code = '205'
          WHERE t.year = ${year.toString()}
            AND LPAD(t.month, 2, '0') = LPAD(${month.toString()}, 2, '0')
          ORDER BY t.emp_code, t.roworder DESC
        ),
        names AS (
          SELECT r.emp_code, btrim(e.fullname_lo) AS salename
          FROM roster r
          JOIN odg_employee e ON e.employee_code = r.emp_code
          WHERE COALESCE(e.fullname_lo, '') <> ''
          UNION
          SELECT r.emp_code, btrim(a.salename)
          FROM roster r
          JOIN app_incentive_sale_alias a ON a.employee_code = r.emp_code
        )
        SELECT
          ur.reward_code, ur.description,
          ur.low_min_qty, ur.low_reward, ur.high_min_qty, ur.high_reward,
          r.emp_code,
          COALESCE(s.units, 0) AS units
        FROM app_incentive_unit_reward ur
        JOIN roster r ON r.group_code = ur.group_code
        LEFT JOIN LATERAL (
          SELECT SUM(sd.qty) AS units
          FROM odg_sale_detail sd
          JOIN names n ON btrim(n.salename) = btrim(sd.salename)
          LEFT JOIN app_incentive_category cat ON cat.category_code = sd.item_category
          WHERE n.emp_code = r.emp_code
            AND ${saleBasis("sd")}
            AND ${saleReportMonth("sd", year, month)}
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
        WHERE ur.is_active
          AND ur.effective_from < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
          AND ur.effective_to >= make_date(${year}, ${month}, 1)
      `.catch(() => []),
    ]);

    const config = configRows[0] ?? {
      currency_code: "THB",
      low_max_pct: 0.5,
      standard_max_pct: 1,
      low_multiplier: 0.8,
      standard_multiplier: 1,
      high_multiplier: 1.1,
      commission_base: 6000,
    };
    const lowMax = number(config.low_max_pct);
    const standardMax = number(config.standard_max_pct);
    const commissionBase = number(config.commission_base);
    const ruleRow = ruleRows[0];
    const commissionRule: CommissionRule = {
      minPct: ruleRow?.commission_min_pct != null ? number(ruleRow.commission_min_pct) : DEFAULT_COMMISSION_RULE.minPct,
      step: ruleRow?.commission_round_step != null ? number(ruleRow.commission_round_step) : DEFAULT_COMMISSION_RULE.step,
      pivotPct: ruleRow?.commission_pivot_pct != null ? number(ruleRow.commission_pivot_pct) : DEFAULT_COMMISSION_RULE.pivotPct,
    };
    // Per-position tier lists (sorted ascending by fromPct). Empty → the scalar
    // commissionRule fallback kicks in inside rateFromTiers.
    const tiersByPosition = new Map<string, CommissionTier[]>();
    for (const t of tierRows) {
      const list = tiersByPosition.get(t.position_code) ?? [];
      list.push({
        fromPct: number(t.from_pct),
        mode: (["zero", "round_down", "round_up", "exact"].includes(t.mode) ? t.mode : "zero") as CommissionTier["mode"],
        roundStep: number(t.round_step),
      });
      tiersByPosition.set(t.position_code, list);
    }
    for (const list of tiersByPosition.values()) list.sort((a, b) => a.fromPct - b.fromPct);
    const rateForPosition = (positionCode: string, achievementPct: number) =>
      rateFromTiers(achievementPct, tiersByPosition.get(positionCode), commissionRule);
    // Workbook matrix: base per (position, product group). Sellers (pos 13)
    // use the base of THEIR group on personal achievement; the single
    // app_incentive_config.commission_base stays as fallback.
    const roleBase = new Map(
      roleCommRows.map((l) => [`${l.position_code}|${l.group_code}`, number(l.base_amount)]),
    );

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
      // A month can end on negative points — a return scored against a bill
      // from an earlier month leaves a lone credit note behind. That is a
      // correction to a bonus already paid, not money owed back out of this
      // one, so the floor is zero, as in the management report.
      const netBonus = Math.max(0, normalBonus) * multiplier;
      // Sellers are position 13.
      const commissionRate = rateForPosition("13", achievementPct);
      const sellerBase = roleBase.get(`13|${row.group_code}`) ?? commissionBase;
      const commission = sellerBase * commissionRate;
      return {
        employeeCode: row.employee_code,
        displayName: row.display_name ?? row.employee_code,
        // odg_employee.position_code: sellers are 13; bosses appended below.
        position: "13" as string | null,
        groupCode: row.group_code,
        soldQty: number(row.sold_qty),
        salesAmount,
        hisenseSales: number(row.hisense_sales),
        bonusPoints: number(row.bonus_points),
        targetPerPerson,
        achievementPct,
        normalBonus,
        multiplier,
        netBonus,
        // Per-set spiffs (④/⑤) are earned by this person and are part of their
        // pay; ② ເງິນພິເສດ is the storefront's pot and is only their share of
        // it, shown so the card can explain the department card's figure.
        unitReward: 0,
        specialReward: 0,

        specialLines: [] as SpecialLine[],
        commissionRate,
        commission,
        commissionBase: sellerBase,
        totalPay: netBonus + commission,
        // Per-group breakdown, only set on manager/head rows below.
        commissionLines: undefined as
          | Array<{ groupCode: string; base: number; achievementPct: number; rate: number; amount: number }>
          | undefined,
      };
    });

    // ② ເງິນພິເສດ — department rewards. One pot per programme, won when the
    // storefront's own monthly total reaches the target, and measured on the
    // same total the roster is banded against: the sales of the people who
    // carry a target. A reward is therefore a department figure, not a line in
    // anyone's pay, and it stays out of totalPay below.
    //
    // split_by_share is the one case a person has a figure of their own: the
    // pot is divided by each seller's share of that total, so the card can say
    // what this month's share came to.
    const departmentSales = mapped.reduce((sum, row) => sum + row.salesAmount, 0);
    const specialRewards: SpecialReward[] = rewardRows.map((reward) => {
      const targetAmount = number(reward.target_amount);
      const rewardAmount = number(reward.reward_amount);
      const achieved = targetAmount > 0 && departmentSales >= targetAmount;
      if (achieved && reward.split_by_share && departmentSales > 0) {
        const hit = `ບັນລຸ ${fmt(departmentSales)}/${fmt(targetAmount)}`;
        for (const row of mapped) {
          const pay = rewardAmount * (row.salesAmount / departmentSales);
          row.specialReward += pay;
          row.specialLines.push({
            label: reward.description?.trim() || reward.reward_code,
            note: `${hit} → ແບ່ງ ${fmt(rewardAmount)} ຕາມ % ຍອດ`,
            amount: pay,
          });
        }
      }
      return {
        code: reward.reward_code,
        description: reward.description?.trim() || reward.reward_code,
        groupCode: reward.group_code,
        targetAmount,
        rewardAmount,
        splitByShare: reward.split_by_share,
        achieved,
        actualAmount: departmentSales,
        achievementPct: targetAmount > 0 ? departmentSales / targetAmount : 0,
      };
    });
    const departmentSpecialTotal = specialRewards.reduce(
      (sum, reward) => sum + (reward.achieved ? reward.rewardAmount : 0),
      0,
    );

    // Unit-count spiffs (workbook ④/⑤): the person's OWN monthly set count
    // picks the tier — reach high_min_qty and EVERY set pays high_reward,
    // else reach low_min_qty and every set pays low_reward.
    for (const line of unitRewardRows) {
      const units = number(line.units);
      if (units <= 0) continue;
      const highMin = number(line.high_min_qty);
      const lowMin = number(line.low_min_qty);
      const pay =
        highMin > 0 && units >= highMin
          ? units * number(line.high_reward)
          : lowMin > 0 && units >= lowMin
            ? units * number(line.low_reward)
            : 0;
      if (pay <= 0) continue;
      const row = mapped.find((r) => r.employeeCode === line.emp_code);
      if (!row) continue;
      row.unitReward += pay;
      row.totalPay += pay;
      const tierMin = highMin > 0 && units >= highMin ? highMin : lowMin;
      const tierRate = highMin > 0 && units >= highMin
        ? number(line.high_reward)
        : number(line.low_reward);
      row.specialLines.push({
        label: line.description?.trim() || line.reward_code,
        note: `${units} ຊຸດ (ຂັ້ນ ≥${tierMin}) × ${fmt(tierRate)}/ຊຸດ`,
        amount: pay,
      });
    }

    // Manager (pos 11) / unit head (pos 12) commission: per product group,
    // base_amount × the SAME rate rule applied to the TEAM's achievement of
    // that group (AIR, CE_SDA, or ALL = whole roster). They carry no personal
    // target/bonus — their whole pay here is this commission.
    const groupAch = (code: "AIR" | "CE_SDA" | "ALL") => {
      const inGroup = code === "ALL" ? mapped : mapped.filter((r) => r.groupCode === code);
      const sales = inGroup.reduce((s, r) => s + r.salesAmount, 0);
      const target = inGroup.reduce((s, r) => s + r.targetPerPerson, 0);
      return target > 0 ? sales / target : 0;
    };
    // Team aggregates from the seller rows only — computed BEFORE any boss row is
    // appended below. Manager/unit-head rows carry no personal target/sales, so
    // their pay is team-based commission; we surface the team figures they are
    // measured on in the sales/target columns instead of a bare 0. These are
    // display-only and excluded from the sales-column total (totalSales) so the
    // footer isn't double-counted.
    const teamQty = mapped.reduce((s, r) => s + r.soldQty, 0);
    const teamSales = mapped.reduce((s, r) => s + r.salesAmount, 0);
    const teamTarget = mapped.reduce((s, r) => s + r.targetPerPerson, 0);
    if (roleCommRows.length > 0 && roleEmpRows.length > 0) {
      const achByGroup = {
        AIR: groupAch("AIR"),
        CE_SDA: groupAch("CE_SDA"),
        ALL: groupAch("ALL"),
      };
      for (const boss of roleEmpRows) {
        // A boss who somehow also has a roster row keeps that row untouched.
        if (mapped.some((r) => r.employeeCode === boss.employee_code)) continue;
        const lines = roleCommRows
          .filter((l) => l.position_code === boss.position_code)
          .map((l) => {
            const g = (l.group_code === "AIR" || l.group_code === "CE_SDA" ? l.group_code : "ALL") as
              | "AIR"
              | "CE_SDA"
              | "ALL";
            const ach = achByGroup[g];
            const rate = rateForPosition(boss.position_code, ach);
            return {
              groupCode: l.group_code,
              base: number(l.base_amount),
              achievementPct: ach,
              rate,
              amount: number(l.base_amount) * rate,
            };
          });
        if (lines.length === 0) continue;
        const commission = lines.reduce((s, l) => s + l.amount, 0);
        mapped.push({
          employeeCode: boss.employee_code,
          displayName:
            boss.fullname_lo?.trim() || boss.nickname?.trim() || boss.employee_code,
          position: boss.position_code,
          groupCode: "",
          soldQty: teamQty,
          salesAmount: teamSales,
          hisenseSales: 0,
          bonusPoints: 0,
          targetPerPerson: teamTarget,
          achievementPct: achByGroup.ALL,
          normalBonus: 0,
          multiplier: 1,
          netBonus: 0,
          unitReward: 0,
          specialReward: 0,

          specialLines: [] as SpecialLine[],
          commissionRate: rateForPosition(boss.position_code, achByGroup.ALL),
          commission,
          commissionBase: 0,
          totalPay: commission,
          commissionLines: lines,
        });
      }
    }

    // Role scope: managers/heads see the whole team; everyone else sees only their own
    // row (department totals above are still computed from the full team, so a person's
    // share of a split reward stays correct).
    const role = roleFromEmployee(employee);
    const isManager = role === "manager" || role === "head";
    // ?self=1 forces the caller's own row only (used by the home bonus card so a
    // manager sees THEIR own bonus, not the team). The report itself omits it.
    const selfOnly = url.searchParams.get("self") === "1";
    let visible = isManager && !selfOnly
      ? mapped
      : mapped.filter((row) => row.employeeCode === employee.employeeCode);
    // The home bonus card (self=1) always renders the caller's own figures. If
    // the caller isn't in this month's target roster — e.g. a manager/head, or a
    // seller with no target set yet — synthesize a zero row so the card still
    // shows (with 0 bonus / commission) instead of disappearing entirely.
    if (selfOnly && visible.length === 0) {
      visible = [
        {
          employeeCode: employee.employeeCode ?? "",
          displayName:
            employee.fullnameLo ?? employee.nickname ?? employee.employeeCode ?? "—",
          position: null,
          groupCode: "",
          soldQty: 0,
          salesAmount: 0,
          hisenseSales: 0,
          bonusPoints: 0,
          targetPerPerson: 0,
          achievementPct: 0,
          normalBonus: 0,
          multiplier: number(config.standard_multiplier),
          netBonus: 0,
          unitReward: 0,
          specialReward: 0,

          specialLines: [] as SpecialLine[],
          commissionRate: 0,
          commission: 0,
          commissionBase: number(config.commission_base),
          totalPay: 0,
          commissionLines: undefined,
        },
      ];
    }

    return NextResponse.json({
      year,
      month,
      scope: isManager ? "all" : "self",
      currencyCode: config.currency_code,
      tiers: {
        lowMaxPct: lowMax,
        standardMaxPct: standardMax,
        lowMultiplier: number(config.low_multiplier),
        standardMultiplier: number(config.standard_multiplier),
        highMultiplier: number(config.high_multiplier),
        commissionMinPct: commissionRule.minPct,
        commissionRoundStep: commissionRule.step,
        commissionPivotPct: commissionRule.pivotPct,
      },
      // Per-position tier lists so the client can render the exact rule the
      // viewer is paid under. Empty object → client uses the scalar rule above.
      commissionTiersByPosition: Object.fromEntries(
        [...tiersByPosition.entries()].map(([pos, list]) => [pos, list.map((t) => ({ fromPct: t.fromPct, mode: t.mode, roundStep: t.roundStep }))]),
      ),
      commissionBase,
      rows: visible,
      // The department programmes and whether the storefront won them, so the
      // report can show the pot beside the pay it is not part of.
      specialRewards,
      // Boss rows (pos 11/12) re-display the team sales as their commission basis,
      // so exclude them here to avoid double-counting the sales-column total.
      totalSales: visible.reduce(
        (sum, row) => sum + (row.position === "11" || row.position === "12" ? 0 : row.salesAmount),
        0,
      ),
      totalBonus: visible.reduce((sum, row) => sum + row.netBonus, 0),
      totalUnitReward: visible.reduce((sum, row) => sum + row.unitReward, 0),
      // ② is the whole storefront's pot for a manager reading the report, and
      // one person's share of it on their own card — a seller shown the
      // department figure would read it as money coming to them.
      totalSpecial: isManager && !selfOnly
        ? departmentSpecialTotal
        : visible.reduce((sum, row) => sum + row.specialReward, 0),
      // (specialLines rides along on each row — see SpecialLine)
      totalCommission: visible.reduce((sum, row) => sum + row.commission, 0),
      totalPay: visible.reduce((sum, row) => sum + row.totalPay, 0),
    });
  } catch (error) {
    console.error("GET /api/reports/incentives failed", error);
    return NextResponse.json(
      { error: "Incentive tables are not installed. Run sql/add-sales-incentive.sql first." },
      { status: 503 },
    );
  }
}
