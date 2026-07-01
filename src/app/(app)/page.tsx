import Link from "next/link";
import type { ReactNode } from "react";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee, canApprovePriceRequests } from "@/lib/roles";
import MyTargetCard from "./MyTargetCard";
import MyBonusCard from "./MyBonusCard";

export const dynamic = "force-dynamic";

// "ໜ້າຮ້ານ ຂົວຫຼວງ" — front-shop sales departments at the Khua Luang branch.
// The whole dashboard is scoped to these departments so every figure reflects
// what was sold / collected at the Khua Luang storefront.
//   2012 ເຄື່ອງໃຊ້ໄຟຟ້າ · 2022 ແອ · 2032 ປະປາ · 2042 ອາໄຫຼ່ · 2062 ໄຟຟ້ານ້ອຍ
// NOTE: the daily-sales report excludes 2042 (ອາໄຫຼ່) per a separate rule; the
// dashboard keeps it so the full storefront is represented. Drop "2042" here to
// align the two.
const KHUA_LUANG_DEPTS = ["2012", "2022", "2032", "2042", "2062"] as const;

type DayMetrics = {
  pending_count: bigint;
  completed_count: bigint;
  cancelled_count: bigint;
  pending_amount: string | number | null;
  completed_amount: string | number | null;
  cancelled_amount: string | number | null;
};

type TopSalesperson = {
  user_owner: string | null;
  fullname_lo: string | null;
  nickname: string | null;
  orders: bigint;
  total: string | number | null;
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

// Today's money actually received at the register — settled CAKAP receipts
// (not SOK sales orders). Cash / transfer split comes from app_payment_line.
type ReceivedToday = {
  receipts: bigint;
  received_kip: string | number | null;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
};

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
  const canSeePriceRequests = canApprovePriceRequests(role);
  const displayName = me.fullnameLo || me.fullnameEn || me.employeeCode || "—";
  const greeting =
    me.nickname && me.nickname !== "0" ? me.nickname : displayName;

  // Front-shop department filter, in unaliased and `t.`-aliased forms so it
  // can drop into each query's WHERE.
  const deptIn = Prisma.sql`department_code IN (${Prisma.join([...KHUA_LUANG_DEPTS])})`;
  const deptInT = Prisma.sql`t.department_code IN (${Prisma.join([...KHUA_LUANG_DEPTS])})`;

  const [
    todayRows,
    yesterdayRows,
    monthRows,
    topRows,
    recentRows,
    dailyRows,
    priceCountRows,
    receivedRows,
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
        AND create_date_time_now::date = CURRENT_DATE - INTERVAL '1 day'
        AND ${deptIn}
    `,
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
        AND create_date_time_now >= date_trunc('month', CURRENT_DATE)
        AND create_date_time_now < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
        AND ${deptIn}
    `,
    prisma.$queryRaw<TopSalesperson[]>`
      SELECT
        eff.salesperson_code AS user_owner,
        emp.fullname_lo,
        emp.nickname,
        COUNT(*)::bigint AS orders,
        COALESCE(SUM(t.total_amount_2), 0) AS total
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
      LEFT JOIN odg_employee emp ON emp.employee_code = eff.salesperson_code
      WHERE t.doc_format_code = 'SOK'
        AND t.create_date_time_now::date = CURRENT_DATE
        AND t.status IN (0, 1)
        AND ${deptInT}
      GROUP BY eff.salesperson_code, emp.fullname_lo, emp.nickname
      ORDER BY total DESC
      LIMIT 5
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
      SELECT
        create_date_time_now::date AS day,
        COALESCE(SUM(total_amount_2), 0) AS total,
        COUNT(*)::bigint AS orders
      FROM ic_trans
      WHERE doc_format_code = 'SOK'
        AND create_date_time_now::date >= CURRENT_DATE - INTERVAL '6 days'
        AND status IN (0, 1)
        AND ${deptIn}
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
    prisma.$queryRaw<ReceivedToday[]>`
      SELECT
        (
          SELECT COUNT(*)::bigint FROM ic_trans t
          WHERE t.doc_format_code = 'CAKAP'
            AND t.doc_date = CURRENT_DATE
            AND COALESCE(t.is_cancel, 0) = 0
            AND ${deptInT}
        ) AS receipts,
        (
          SELECT COALESCE(SUM(t.total_amount_2), 0) FROM ic_trans t
          WHERE t.doc_format_code = 'CAKAP'
            AND t.doc_date = CURRENT_DATE
            AND COALESCE(t.is_cancel, 0) = 0
            AND ${deptInT}
        ) AS received_kip,
        (
          SELECT COALESCE(SUM(p.amount), 0)
          FROM app_payment_line p
          JOIN ic_trans t ON t.doc_no = p.doc_no AND t.doc_format_code = 'CAKAP'
          WHERE t.doc_date = CURRENT_DATE
            AND COALESCE(t.is_cancel, 0) = 0
            AND p.pay_method = 'cash' AND p.currency_code = '02'
        ) AS cash_kip,
        (
          SELECT COALESCE(SUM(p.amount), 0)
          FROM app_payment_line p
          JOIN ic_trans t ON t.doc_no = p.doc_no AND t.doc_format_code = 'CAKAP'
          WHERE t.doc_date = CURRENT_DATE
            AND COALESCE(t.is_cancel, 0) = 0
            AND p.pay_method = 'transfer' AND p.currency_code = '02'
        ) AS transfer_kip
    `,
  ]);

  const received = receivedRows[0];
  const receivedKip = Number(received?.received_kip ?? 0);
  const receivedReceipts = Number(received?.receipts ?? 0);
  const receivedCash = Number(received?.cash_kip ?? 0);
  const receivedTransfer = Number(received?.transfer_kip ?? 0);

  const today = normalizeMetrics(todayRows[0]);
  const yesterday = normalizeMetrics(yesterdayRows[0]);
  const month = normalizeMetrics(monthRows[0]);

  const todayTotal = today.pendingAmount + today.completedAmount;
  const yesterdayTotal = yesterday.pendingAmount + yesterday.completedAmount;
  const monthTotal = month.pendingAmount + month.completedAmount;
  const todayOrders = today.pendingCount + today.completedCount;
  const yesterdayOrders = yesterday.pendingCount + yesterday.completedCount;
  const monthOrders = month.pendingCount + month.completedCount;
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
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Premium Hero Banner Greeting */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-xl md:p-8">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:24px_24px] opacity-20" />
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        
        <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-300">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-emerald-300 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online
              </span>
              <span>·</span>
              <span>{dateFmt.format(now)}</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              {timeOfDay}, {greeting}
            </h1>
            <p className="max-w-xl text-xs text-slate-300">
              ສະຫຼຸບການຂາຍ, ຄິວຮັບເງິນ, ແລະວຽກທີ່ຕ້ອງຕິດຕາມໃນມື້ນີ້
            </p>
          </div>
          
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <UserBadge
              name={displayName}
              employeeCode={me.employeeCode ?? "—"}
              role={role}
            />
            <Link
              href="/orders/new"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-500 active:translate-y-0 active:scale-[0.98] sm:w-auto sm:justify-start"
            >
              <PlusIcon />
              ສ້າງບິນໃໝ່
            </Link>
          </div>
        </div>
      </div>

      <MyTargetCard />
      <MyBonusCard />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="ຮັບເງິນມື້ນີ້"
          value={moneyFmt.format(receivedKip)}
          unit="ກີບ"
          sub={`${numFmt.format(receivedReceipts)} ໃບບິນ · ສົດ ${compactMoneyFmt.format(receivedCash)} · ໂອນ ${compactMoneyFmt.format(receivedTransfer)}`}
          icon={<CashIcon />}
          accent="primary"
        />
        <MetricCard
          title="ຍອດຂາຍມື້ນີ້"
          value={moneyFmt.format(todayTotal)}
          unit="ກີບ"
          sub={`${numFmt.format(todayOrders)} ບິນ · ສະເລ່ຍ ${compactMoneyFmt.format(avg)}/ບິນ`}
          delta={totalDeltaPct}
          icon={<SalesIcon />}
          accent="info"
        />
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
          unit="ກີບ"
          sub={`${numFmt.format(monthOrders)} ບິນໃນເດືອນນີ້`}
          icon={<CalendarIcon />}
          accent="warning"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.9fr)]">
        <div className="space-y-5">
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
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <MiniStat label="ຮວມ 7 ວັນ" value={`${moneyFmt.format(weekTotal)} ກີບ`} />
              <MiniStat label="ຈຳນວນບິນ" value={`${numFmt.format(weekOrders)} ບິນ`} />
              <MiniStat
                label="ວັນສູງສຸດ"
                value={`${compactMoneyFmt.format(highestDay.total)} ກີບ`}
              />
            </div>
            <AreaChart series={dailySeries} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
            <Panel title="ມື້ນີ້ ທຽບກັບ ມື້ວານ" eyebrow="Comparison">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      ສັດສ່ວນຍອດຂາຍ
                    </span>
                    <span className="text-slate-400 font-semibold">
                      ຮວມ {moneyFmt.format(totalBothDays)} ກີບ
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <SplitStat
                    label="ມື້ນີ້"
                    value={`${moneyFmt.format(todayTotal)} ກີບ`}
                    meta={`${todayRatio.toFixed(0)}%`}
                    tone="primary"
                  />
                  <SplitStat
                    label="ມື້ວານ"
                    value={`${moneyFmt.format(yesterdayTotal)} ກີບ`}
                    meta={`${(100 - todayRatio).toFixed(0)}%`}
                    tone="muted"
                  />
                </div>
              </div>
            </Panel>

            <PriceRequestPanel
              canSeePriceRequests={canSeePriceRequests}
              pendingPriceRequests={pendingPriceRequests}
              approvedPricesToday={approvedPricesToday}
            />
          </div>

          <Panel title="ທາງລັດ" eyebrow="Quick actions">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                href="/reports/daily-sales"
                label="ລາຍງານ"
                icon={<ReportIcon />}
                accent="info"
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

        <aside className="space-y-5">
          <Panel
            title="Top ພະນັກງານຂາຍ"
            eyebrow="Today ranking"
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
              <EmptyHint>ຍັງບໍ່ມີຍອດຂາຍວັນນີ້</EmptyHint>
            ) : (
              <ul className="space-y-3">
                {topRows.map((r, i) => {
                  const total = Number(r.total ?? 0);
                  const pct = topTotal > 0 ? (total / topTotal) * 100 : 0;
                  const name =
                    r.fullname_lo?.trim() ||
                    r.nickname?.trim() ||
                    r.user_owner ||
                    "ບໍ່ລະບຸ";

                  return (
                    <li
                      key={(r.user_owner ?? "") + i}
                      className="group flex flex-col gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 p-3 hover:border-indigo-100 hover:bg-white transition-all duration-300"
                    >
                      <div className="flex items-center gap-3">
                        <span className={rankBadgeClass(i)}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-slate-800">
                            {name}
                          </div>
                          <div className="text-[10px] text-slate-400 font-semibold">
                            {numFmt.format(Number(r.orders))} ບິນ
                          </div>
                        </div>
                        <div className="text-right text-xs font-black text-indigo-600">
                          {compactMoneyFmt.format(total)}
                        </div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
                        <div
                          className={rankBarClass(i)}
                          style={{ width: `${Math.max(pct, 4).toFixed(1)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

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

function UserBadge({
  name,
  employeeCode,
  role,
}: {
  name: string;
  employeeCode: string;
  role: string;
}) {
  return (
    <div className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md px-3.5 shadow-sm text-white sm:w-auto sm:inline-flex">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/30 text-xs font-bold text-indigo-200">
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 text-left">
        <span className="block max-w-[10rem] truncate text-xs font-bold text-white leading-tight sm:max-w-32">
          {name}
        </span>
        <span className="block text-[9px] uppercase text-slate-300 tracking-wider">
          {employeeCode} · {role}
        </span>
      </span>
    </div>
  );
}

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
  return (
    <article
      className={`odoo-card border-l-4 ${c.border} p-5 hover:scale-[1.015] hover:shadow-xl transition-all duration-300`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-md ${c.icon}`}>
          {icon}
        </span>
        {delta !== undefined && delta !== null ? <DeltaPill value={delta} /> : null}
      </div>
      <div className="text-[10px] font-semibold text-odoo-text-muted">{title}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="break-all text-lg font-bold text-odoo-text-strong sm:text-xl">
          {value}
        </span>
        {unit ? <span className="text-[10px] font-semibold text-odoo-text-muted">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-2 text-[10px] text-odoo-text-muted">{sub}</div> : null}
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
              {`${dayShortFmt.format(p.date)} · ${moneyFmt.format(p.total)} ກີບ · ${p.orders} ບິນ`}
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
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

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 4 4 5-6" />
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
