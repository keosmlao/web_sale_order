import { requireEmployee } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSummaryRows, projectMonth } from "@/lib/company-summary";
import { fmt, LAO_MONTHS } from "@/lib/incentive-period";
import SummaryTable from "./SummaryTable";
import YearFilter from "./YearFilter";

export const dynamic = "force-dynamic";

// Postgres numerics arrive as string (or number) over $queryRaw.
type Num = string | number | null;
const num = (value: Num | undefined) => Number(value ?? 0) || 0;

type MonthAmount = { y: Num; m: Num; amt: Num };
type TargetAmount = { m: Num; amt: Num };
type LastDay = { last_day: Date | null };

const FIRST_YEAR = 2025;

function vientianeToday(): { year: number; month: number } {
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

export default async function TotalCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireEmployee();

  const today = vientianeToday();
  const params = await searchParams;
  const requested = Number(params.year);
  const year =
    Number.isInteger(requested) && requested >= FIRST_YEAR && requested <= today.year + 1
      ? requested
      : today.year;
  const years: number[] = [];
  for (let y = FIRST_YEAR; y <= today.year + 1; y++) years.push(y);

  // Months already closed. A past year is complete; a future year has nothing
  // banked yet and reads as pure target.
  const completeThrough =
    year < today.year ? 12 : year > today.year ? 0 : Math.max(0, today.month - 1);
  const inProgressMonth = completeThrough + 1;

  const [salesRows, targetRows, lastDayRows] = await Promise.all([
    // Total Company = every sale line, unfiltered. This is deliberately NOT
    // the storefront basis in @/lib/sales-basis — that one scopes to branch 01
    // walk-in retail, while this sheet reports the whole company.
    prisma.$queryRaw<MonthAmount[]>`
      SELECT EXTRACT(YEAR FROM doc_date)::int AS y,
             EXTRACT(MONTH FROM doc_date)::int AS m,
             COALESCE(SUM(sum_amount), 0) AS amt
      FROM odg_sale_detail
      WHERE doc_date >= make_date(${year - 1}, 1, 1)
        AND doc_date < make_date(${year + 1}, 1, 1)
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<TargetAmount[]>`
      SELECT target_month::int AS m, COALESCE(SUM(target_amount), 0) AS amt
      FROM odg_sales_target
      WHERE target_year = ${year}
      GROUP BY 1
    `,
    // How far into the in-progress month the data actually reaches. Dividing
    // the run-rate by this instead of by today's date keeps a month whose sync
    // is a day or two behind from reading artificially low.
    inProgressMonth <= 12
      ? prisma.$queryRaw<LastDay[]>`
          SELECT MAX(doc_date)::date AS last_day
          FROM odg_sale_detail
          WHERE doc_date >= make_date(${year}, ${inProgressMonth}, 1)
            AND doc_date < make_date(${year}, ${inProgressMonth}, 1) + INTERVAL '1 month'
        `
      : Promise.resolve([] as LastDay[]),
  ]);

  const act = Array<number>(12).fill(0);
  const lastYear = Array<number>(12).fill(0);
  for (const row of salesRows) {
    const rowYear = num(row.y);
    const index = num(row.m) - 1;
    if (index < 0 || index > 11) continue;
    if (rowYear === year) act[index] = num(row.amt);
    else if (rowYear === year - 1) lastYear[index] = num(row.amt);
  }

  const target = Array<number>(12).fill(0);
  for (const row of targetRows) {
    const index = num(row.m) - 1;
    if (index >= 0 && index <= 11) target[index] = num(row.amt);
  }

  const lastDay = lastDayRows[0]?.last_day ?? null;
  const daysWithData = lastDay ? lastDay.getUTCDate() : 0;
  const daysInMonth =
    inProgressMonth <= 12 ? new Date(year, inProgressMonth, 0).getDate() : 0;
  const runRate =
    inProgressMonth <= 12
      ? projectMonth(act[inProgressMonth - 1] ?? 0, daysWithData, daysInMonth)
      : null;

  const base = { year, act, lastYear, target, completeThrough };
  const workbookRows = buildSummaryRows({ ...base, currentMonthEstimate: null });
  const runRateRows = buildSummaryRows({ ...base, currentMonthEstimate: runRate });

  const hasTargets = target.some((value) => value > 0);

  return (
    <div className="odoo-page">
      <div className="odoo-page-header">
        <div>
          <h1 className="odoo-page-title">Total Company</h1>
          <p className="odoo-page-subtitle">
            ສະຫລຸບຍອດຂາຍທັງບໍລິສັດ ທຽບເປົ້າ ແລະ ປີ {year - 1}
          </p>
        </div>
        <YearFilter year={year} years={years} />
      </div>

      {!hasTargets && (
        <div className="odoo-alert-danger mb-4">
          ບໍ່ມີເປົ້າໝາຍປີ {year} ໃນ odg_sales_target — ຖັນ Target ແລະ % ຈະເປັນ 0.
        </div>
      )}

      <div className="odoo-card mb-5">
        <div className="odoo-card-header">
          <div>
            <span className="font-semibold">ແບບ Excel</span>
            <span className="ml-2 text-xs text-odoo-text-muted">
              ເດືອນທີ່ຍັງບໍ່ປິດ ໃຊ້ Target ເປັນ Est. (ຄືກັບຊີດ)
            </span>
          </div>
        </div>
        <SummaryTable rows={workbookRows} year={year} />
      </div>

      <div className="odoo-card">
        <div className="odoo-card-header">
          <div>
            <span className="font-semibold">ແບບ run-rate</span>
            <span className="ml-2 text-xs text-odoo-text-muted">
              {runRate !== null
                ? `ເດືອນ ${LAO_MONTHS[inProgressMonth - 1]} ຄາດຄະເນຈາກຍອດຈິງ ${fmt.format(
                    Math.round(act[inProgressMonth - 1] ?? 0),
                  )} ໃນ ${daysWithData}/${daysInMonth} ວັນ = ${fmt.format(Math.round(runRate))}`
                : "ຍັງບໍ່ມີຍອດຈິງໃນເດືອນນີ້ — ຄືກັບຕາຕະລາງເທິງ"}
            </span>
          </div>
        </div>
        <SummaryTable rows={runRateRows} year={year} />
      </div>
    </div>
  );
}
