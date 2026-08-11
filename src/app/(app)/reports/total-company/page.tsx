import { requireEmployee } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSummaryRows, projectMonth } from "@/lib/company-summary";
import { fmt, LAO_MONTHS } from "@/lib/incentive-period";
import { LIVE_SALES_SOURCE, LIVE_SALE_AMOUNT } from "@/lib/live-sales";
import SummaryTable from "./SummaryTable";
import YearFilter from "./YearFilter";

export const dynamic = "force-dynamic";

// Postgres numerics arrive as string (or number) over $queryRaw.
type Num = string | number | null;
const num = (value: Num | undefined) => Number(value ?? 0) || 0;

type MonthAmount = { y: Num; m: Num; amt: Num };
type TargetAmount = { m: Num; amt: Num };
type LastDay = { last_day: Date | null };
type ApprovedPeriod = { period_type: string; period_no: Num; amt: Num };

const FIRST_YEAR = 2025;

function vientianeToday(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    day: Number(parts.find((p) => p.type === "day")?.value),
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

  const [salesRows, targetRows, lastDayRows, freshnessRows, approvedRows] = await Promise.all([
    // Total Company = every sale line in the ERP, no branch / argroup / item
    // filter. Deliberately NOT the storefront basis in @/lib/sales-basis, which
    // scopes to branch 01 walk-in retail; this sheet reports the whole company.
    // See @/lib/live-sales for why it reads ic_trans rather than the ETL copy.
    prisma.$queryRaw<MonthAmount[]>`
      SELECT EXTRACT(YEAR FROM t.doc_date)::int AS y,
             EXTRACT(MONTH FROM t.doc_date)::int AS m,
             COALESCE(SUM(${LIVE_SALE_AMOUNT}), 0) AS amt
      ${LIVE_SALES_SOURCE}
        AND t.doc_date >= make_date(${year - 1}, 1, 1)
        AND t.doc_date < make_date(${year + 1}, 1, 1)
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
          SELECT MAX(t.doc_date)::date AS last_day
          ${LIVE_SALES_SOURCE}
            AND t.doc_date >= make_date(${year}, ${inProgressMonth}, 1)
            AND t.doc_date < make_date(${year}, ${inProgressMonth}, 1) + INTERVAL '1 month'
        `
      : Promise.resolve([] as LastDay[]),
    // Latest day carrying sales anywhere in the ERP. Reading live, this is
    // today as soon as the first bill is rung up, so the page can say how
    // current it is rather than leaving the reader to guess.
    prisma.$queryRaw<LastDay[]>`SELECT MAX(t.doc_date)::date AS last_day ${LIVE_SALES_SOURCE}`,
    // Closed periods finance has signed off — see
    // sql/add-closed-period-actual.sql. odg_sale_detail keeps moving after a
    // period closes, so the approved figure is pinned here instead of drifting.
    prisma.$queryRaw<ApprovedPeriod[]>`
      SELECT period_type, period_no::int AS period_no, amount AS amt
      FROM app_closed_period_actual
      WHERE year = ${year}
    `,
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

  // Approved figures replace the live total, but only for periods that have
  // actually closed — pinning the in-progress month would freeze a total that
  // is still being earned.
  const closedMonth = (m: number) => m >= 1 && m <= completeThrough;
  const pinned = new Set<number>();
  const approvedLabels: string[] = [];

  for (const row of approvedRows) {
    if (row.period_type !== "month") continue;
    const month = num(row.period_no);
    if (!closedMonth(month)) continue;
    act[month - 1] = num(row.amt);
    pinned.add(month);
    approvedLabels.push(LAO_MONTHS[month - 1]);
  }

  // A quarter figure is spread over the months it covers in proportion to what
  // they actually sold, so the quarter total and everything summing across it
  // match the sheet without anyone having to approve a month split. Months
  // already pinned individually keep their value and absorb none of the spread.
  for (const row of approvedRows) {
    if (row.period_type !== "quarter") continue;
    const quarter = num(row.period_no);
    const months = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
    if (!months.every(closedMonth)) continue;

    const free = months.filter((m) => !pinned.has(m));
    if (free.length === 0) continue;
    const fixedTotal = months
      .filter((m) => pinned.has(m))
      .reduce((sum, m) => sum + act[m - 1], 0);
    const remainder = num(row.amt) - fixedTotal;
    const liveTotal = free.reduce((sum, m) => sum + act[m - 1], 0);

    for (const m of free) {
      act[m - 1] =
        liveTotal > 0 ? (act[m - 1] / liveTotal) * remainder : remainder / free.length;
    }
    approvedLabels.push(`ໄຕມາດ ${quarter}`);
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

  // Freshness of the whole page, and how far behind Vientiane "today" it is.
  const dataThrough = freshnessRows[0]?.last_day ?? null;
  const dataThroughLabel = dataThrough
    ? `${String(dataThrough.getUTCDate()).padStart(2, "0")}/${String(
        dataThrough.getUTCMonth() + 1,
      ).padStart(2, "0")}/${dataThrough.getUTCFullYear()}`
    : "—";
  const daysBehind = dataThrough
    ? Math.max(
        0,
        Math.round(
          (Date.UTC(today.year, today.month - 1, today.day) - dataThrough.getTime()) / 86_400_000,
        ),
      )
    : 0;

  const base = { year, act, lastYear, target, completeThrough };
  const workbookRows = buildSummaryRows({ ...base, currentMonthEstimate: null });
  const runRateRows = buildSummaryRows({ ...base, currentMonthEstimate: runRate });

  const hasTargets = target.some((value) => value > 0);
  const banked = workbookRows.find((row) => row.key === "banked");
  const fullYear = workbookRows.find((row) => row.key === "full-year");
  const currentEstimate = runRateRows.find((row) => row.key === "est-this");
  const targetAchievement = banked && banked.target > 0 ? (banked.act / banked.target) * 100 : 0;
  const forecastAchievement = fullYear && fullYear.target > 0 ? (fullYear.act / fullYear.target) * 100 : 0;
  const yearGrowth = fullYear && fullYear.lastYear > 0 ? ((fullYear.act / fullYear.lastYear) - 1) * 100 : 0;

  return (
    <div className="odoo-page max-w-[1600px]">
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-odoo-primary-dark via-odoo-primary to-odoo-primary-light p-5 text-white shadow-[0_18px_45px_-20px_rgba(0,51,97,0.55)] sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">EXECUTIVE SALES OVERVIEW</div>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">ພາບລວມຍອດຂາຍທັງບໍລິສັດ</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-white/72">ຕິດຕາມຍອດຈິງ, ເປົ້າໝາຍ, ການຄາດຄະເນ ແລະການເຕີບໂຕທຽບກັບປີ {year - 1}</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm"><YearFilter year={year} years={years} /></div>
        </div>
      </section>

      {daysBehind > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-odoo-warning-border bg-odoo-warning-bg px-4 py-3 text-xs font-semibold text-odoo-warning-text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-px h-4 w-4 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <span>
            ຍັງບໍ່ມີບິນຂອງມື້ນີ້ໃນລະບົບ — ບິນລ້າສຸດແມ່ນ {dataThroughLabel} ({daysBehind} ວັນຜ່ານມາ).
          </span>
        </div>
      )}

      {approvedLabels.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-odoo-primary-200 bg-odoo-primary-50 px-4 py-3 text-xs font-semibold text-odoo-primary-dark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-px h-4 w-4 shrink-0"><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
          <span>
            {approvedLabels.join(", ")} ໃຊ້ຍອດທີ່ບັນຊີອະນຸມັດ ແທນຍອດສົດຈາກ ERP.
            ແກ້ໄຂ ຫຼື ລຶບອອກໄດ້ໃນຕາຕະລາງ app_closed_period_actual.
          </span>
        </div>
      )}

      {!hasTargets && (
        <div className="odoo-alert-danger mb-4">
          ບໍ່ມີເປົ້າໝາຍປີ {year} ໃນ odg_sales_target — ຖັນ Target ແລະ % ຈະເປັນ 0.
        </div>
      )}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="ຍອດຈິງສະສົມ" value={fmt.format(Math.round(banked?.act ?? 0))} sub={`ຮອດ ${LAO_MONTHS[Math.max(completeThrough - 1, 0)] ?? "—"} ${year}`} tone="primary" />
        <KpiCard label="ບັນລຸເປົ້າປະຈຳປີ" value={`${targetAchievement.toFixed(1)}%`} sub={`ເປົ້າ ${fmt.format(Math.round(banked?.target ?? 0))}`} tone={targetAchievement >= 100 ? "success" : "warning"} progress={targetAchievement} />
        <KpiCard label="ຄາດຄະເນເຕັມປີ" value={fmt.format(Math.round(fullYear?.act ?? 0))} sub={`${forecastAchievement.toFixed(1)}% ຂອງເປົ້າ`} tone="sky" progress={forecastAchievement} />
        <KpiCard label="ເຕີບໂຕທຽບປີກ່ອນ" value={`${yearGrowth >= 0 ? "+" : ""}${yearGrowth.toFixed(1)}%`} sub={`ປີ ${year - 1}: ${fmt.format(Math.round(fullYear?.lastYear ?? 0))}`} tone={yearGrowth >= 0 ? "success" : "danger"} />
      </section>

      <section className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="odoo-card flex items-center gap-4 p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-odoo-primary-50 text-odoo-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg>
          </span>
          <div className="min-w-0"><div className="text-[10px] font-black text-odoo-text-muted">RUN-RATE ເດືອນປັດຈຸບັນ</div><div className="mt-1 text-sm font-black text-odoo-text-strong">{currentEstimate ? `${fmt.format(Math.round(currentEstimate.act))} ກີບ` : "ຍັງບໍ່ມີຍອດພຽງພໍສຳລັບຄາດຄະເນ"}</div><div className="mt-0.5 text-[11px] text-odoo-text-muted">ຄຳນວນຈາກຂໍ້ມູນ {daysWithData}/{daysInMonth} ວັນ</div></div>
        </div>
        <div className="odoo-card flex items-center gap-6 px-5 py-4"><MiniMetric label="ຂໍ້ມູນຮອດ" value={dataThroughLabel} /><MiniMetric label="ເດືອນປິດແລ້ວ" value={`${completeThrough}/12`} /><MiniMetric label="ປີລາຍງານ" value={String(year)} /></div>
      </section>

      <div className="odoo-card mb-5 overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-odoo-border bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-black text-odoo-text-strong">ມຸມມອງຕາມແຜນ Excel</h2><p className="mt-1 text-[11px] text-odoo-text-muted">ເດືອນທີ່ຍັງບໍ່ປິດ ໃຊ້ Target ເປັນຄ່າຄາດຄະເນ</p></div>
          <span className="self-start rounded-full bg-odoo-primary-50 px-3 py-1 text-[10px] font-black text-odoo-primary">OFFICIAL PLAN</span>
        </div>
        <SummaryTable rows={workbookRows} year={year} />
      </div>

      <div className="odoo-card overflow-hidden">
        <div className="flex flex-col gap-1 border-b border-odoo-border bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-black text-odoo-text-strong">ມຸມມອງຄາດຄະເນຕາມ Run-rate</h2><p className="mt-1 text-[11px] text-odoo-text-muted">
              {runRate !== null
                ? `ເດືອນ ${LAO_MONTHS[inProgressMonth - 1]} ຄາດຄະເນຈາກຍອດຈິງ ${fmt.format(
                    Math.round(act[inProgressMonth - 1] ?? 0),
                  )} ໃນ ${daysWithData}/${daysInMonth} ວັນ = ${fmt.format(Math.round(runRate))}`
                : "ຍັງບໍ່ມີຍອດຈິງໃນເດືອນນີ້ — ຄືກັບຕາຕະລາງເທິງ"}
            </p></div>
          <span className="self-start rounded-full bg-odoo-warning-bg px-3 py-1 text-[10px] font-black text-odoo-warning-text">LIVE FORECAST</span>
        </div>
        <SummaryTable rows={runRateRows} year={year} />
      </div>
    </div>
  );
}

type KpiTone = "primary" | "sky" | "success" | "warning" | "danger";
const KPI_TONE: Record<KpiTone, string> = {
  primary: "border-odoo-primary bg-gradient-to-br from-odoo-primary-dark to-odoo-primary text-white",
  sky: "border-odoo-primary-200 bg-odoo-primary-50 text-odoo-text-strong",
  success: "border-odoo-success-border bg-odoo-success-bg text-odoo-text-strong",
  warning: "border-odoo-warning-border bg-odoo-warning-bg text-odoo-text-strong",
  danger: "border-odoo-danger-border bg-odoo-danger-bg text-odoo-text-strong",
};

function KpiCard({ label, value, sub, tone, progress }: { label: string; value: string; sub: string; tone: KpiTone; progress?: number }) {
  const dark = tone === "primary";
  return <article className={`relative overflow-hidden rounded-2xl border p-4 shadow-sm ${KPI_TONE[tone]}`}><div className={`text-[10px] font-black ${dark ? "text-white/65" : "text-odoo-text-muted"}`}>{label}</div><div className="mt-2 truncate text-2xl font-black tracking-tight">{value}</div><div className={`mt-1 truncate text-[10px] font-semibold ${dark ? "text-white/65" : "text-odoo-text-muted"}`}>{sub}</div>{progress !== undefined ? <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-white/75"}`}><div className="h-full rounded-full bg-gradient-to-r from-odien-orange to-odien-yellow" style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }} /></div> : null}</article>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[9px] font-bold text-odoo-text-muted">{label}</div><div className="mt-1 text-lg font-black text-odoo-primary-dark">{value}</div></div>;
}
