import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee, canApprovePriceRequests } from "@/lib/roles";

export const dynamic = "force-dynamic";

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

export default async function HomePage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canSeePriceRequests = canApprovePriceRequests(role);
  const displayName = me.fullnameLo || me.fullnameEn || me.employeeCode || "—";
  const greeting =
    me.nickname && me.nickname !== "0" ? me.nickname : displayName;

  const [todayRows, yesterdayRows, monthRows, topRows, recentRows, dailyRows, priceCountRows] =
    await Promise.all([
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
        ORDER BY t.create_date_time_now DESC
        LIMIT 8
      `,
      // Last 7 days of sales — drives the inline area chart. We zero-fill
      // missing days client-side so the chart always shows a full week.
      prisma.$queryRaw<DailyBar[]>`
        SELECT
          create_date_time_now::date AS day,
          COALESCE(SUM(total_amount_2), 0) AS total,
          COUNT(*)::bigint AS orders
        FROM ic_trans
        WHERE doc_format_code = 'SOK'
          AND create_date_time_now::date >= CURRENT_DATE - INTERVAL '6 days'
          AND status IN (0, 1)
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
    ]);

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

  const topTotal = Number(topRows[0]?.total ?? 0);

  const priceCounts = priceCountRows[0];
  const pendingPriceRequests = Number(priceCounts?.pending ?? 0);
  const approvedPricesToday = Number(priceCounts?.approved_today ?? 0);

  const now = new Date();
  const hour = now.getHours();
  const timeOfDay =
    hour < 11 ? "ສະບາຍດີຕອນເຊົ້າ" : hour < 17 ? "ສະບາຍດີຕອນບ່າຍ" : "ສະບາຍດີຕອນແລງ";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Hero greeting with gradient */}
      <header className="relative overflow-hidden rounded-2xl border border-odoo-border bg-gradient-to-br from-odoo-primary via-odoo-primary-dark to-[#312e81] p-6 text-white shadow-lg sm:p-8">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-16 -left-8 h-40 w-40 rounded-full bg-odoo-accent/30 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
              {timeOfDay}
            </div>
            <h1 className="mt-1.5 text-3xl font-bold tracking-tight sm:text-4xl">
              {greeting}
            </h1>
            <p className="mt-2 max-w-md text-sm text-white/80">
              ມື້ນີ້ມີ {numFmt.format(todayOrders)} ບິນ · ຍອດຮວມ{" "}
              <span className="font-mono font-bold">
                {compactMoneyFmt.format(todayTotal)}
              </span>{" "}
              ກີບ
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="rounded-xl bg-white/15 px-4 py-2.5 backdrop-blur-sm">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">
                ມື້ນີ້
              </div>
              <div className="mt-0.5 text-sm font-semibold">
                {new Intl.DateTimeFormat("lo-LA", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                  timeZone: "Asia/Vientiane",
                }).format(now)}
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/orders/new"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-bold text-odoo-primary shadow-sm transition hover:bg-white/90"
              >
                <span className="text-base leading-none">+</span> ສ້າງບິນໃໝ່
              </Link>
              <Link
                href="/cashier"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                ຮັບເງິນ
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* KPI cards */}
      <section className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          accent="primary"
          label="ຍອດຂາຍມື້ນີ້"
          value={moneyFmt.format(todayTotal)}
          unit="ກີບ"
          subtitle={`${numFmt.format(todayOrders)} ບິນ`}
          delta={totalDeltaPct}
          deltaLabel="vs ມື້ວານ"
          icon={<TrendIcon />}
        />
        <KpiCard
          accent="warning"
          label="ລໍຖ້າຮັບເງິນ"
          value={moneyFmt.format(today.pendingAmount)}
          unit="ກີບ"
          subtitle={`${numFmt.format(today.pendingCount)} ບິນ · ກົດເພື່ອຮັບເງິນ`}
          href="/cashier"
          icon={<ClockIcon />}
        />
        <KpiCard
          accent="success"
          label="ສະເລ່ຍ/ບິນ"
          value={moneyFmt.format(avg)}
          unit="ກີບ"
          subtitle={`${numFmt.format(today.completedCount)} ບິນຮັບເງິນແລ້ວ`}
          icon={<CheckIcon />}
        />
        <KpiCard
          accent="info"
          label="ຍອດເດືອນນີ້"
          value={moneyFmt.format(monthTotal)}
          unit="ກີບ"
          subtitle={`${numFmt.format(monthOrders)} ບິນ`}
          href="/reports/salespeople"
          icon={<CalendarIcon />}
        />
      </section>

      {/* 7-day chart + action items */}
      <section className="mt-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel
          title="ຍອດຂາຍ 7 ວັນຍ້ອນຫຼັງ"
          subtitle={`ຮວມ ${compactMoneyFmt.format(weekTotal)} ກີບ · ${numFmt.format(weekOrders)} ບິນ`}
          link={{ href: "/reports/daily-sales", label: "ລາຍງານລະອຽດ →" }}
        >
          <AreaChart series={dailySeries} />
        </Panel>

        <Panel title="ລາຍການດ່ວນ" subtitle="ສິ່ງທີ່ຕ້ອງເຮັດວັນນີ້">
          <ul className="space-y-2">
            <ActionItem
              label="ບິນລໍຖ້າຊຳລະ"
              count={today.pendingCount}
              amount={today.pendingAmount}
              tone={today.pendingCount > 0 ? "warning" : "neutral"}
              href="/cashier"
              icon={<ClockIcon />}
            />
            {canSeePriceRequests ? (
              <ActionItem
                label="ຄຳຂໍລາຄາພິເສດ"
                count={pendingPriceRequests}
                tone={pendingPriceRequests > 0 ? "danger" : "neutral"}
                sub={`ອະນຸມັດແລ້ວວັນນີ້: ${approvedPricesToday}`}
                icon={<TagIcon />}
              />
            ) : (
              <ActionItem
                label="ລາຄາພິເສດອະນຸມັດແລ້ວ"
                count={approvedPricesToday}
                tone="success"
                href="/cashier"
                sub="ກວດສອບໃນໜ້າຮັບເງິນ"
                icon={<TagIcon />}
              />
            )}
            {today.cancelledCount > 0 ? (
              <ActionItem
                label="ບິນຍົກເລີກວັນນີ້"
                count={today.cancelledCount}
                amount={today.cancelledAmount}
                tone="danger"
                icon={<XIcon />}
              />
            ) : null}
          </ul>
        </Panel>
      </section>

      {/* Compare strip */}
      <section className="mt-4 rounded-xl border border-odoo-border bg-gradient-to-r from-white via-odoo-primary-50/40 to-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-xs">
          <Stat
            label="ມື້ວານ"
            value={`${moneyFmt.format(yesterdayTotal)} ກີບ`}
            sub={`${numFmt.format(yesterdayOrders)} ບິນ`}
          />
          <div className="h-8 w-px bg-odoo-border" />
          <Stat label="ບິນ ມື້ນີ້ vs ມື້ວານ" value="" delta={ordersDeltaPct} />
          <Stat label="ຍອດ ມື້ນີ້ vs ມື້ວານ" value="" delta={totalDeltaPct} />
        </div>
      </section>

      {/* Top salespeople + recent activity */}
      <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Panel
          title="Top ພະນັກງານຂາຍ ມື້ນີ້"
          subtitle="ຈັດອັນດັບຕາມຍອດຂາຍ"
          link={{ href: "/reports/salespeople", label: "ເບິ່ງທັງໝົດ →" }}
        >
          {topRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີຍອດຂາຍວັນນີ້</EmptyHint>
          ) : (
            <ul className="space-y-2.5">
              {topRows.map((r, i) => {
                const total = Number(r.total ?? 0);
                const pct = topTotal > 0 ? (total / topTotal) * 100 : 0;
                const name =
                  r.fullname_lo?.trim() ||
                  r.nickname?.trim() ||
                  r.user_owner ||
                  "ບໍ່ລະບຸ";
                const initial = name.trim().charAt(0).toUpperCase();
                return (
                  <li
                    key={(r.user_owner ?? "") + i}
                    className="group flex items-center gap-3 rounded-xl border border-odoo-border bg-odoo-surface p-3 transition hover:border-odoo-primary-200 hover:shadow-sm"
                  >
                    <div className="relative">
                      <div
                        className={
                          "flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white shadow-sm " +
                          rankAvatarBg(i)
                        }
                      >
                        {initial || "?"}
                      </div>
                      <div
                        className={
                          "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white font-mono text-[10px] font-bold " +
                          rankBadgeBg(i)
                        }
                      >
                        {i + 1}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate text-sm font-bold text-odoo-text-strong">
                          {name}
                        </div>
                        <div className="font-mono text-sm font-bold text-odoo-text-strong">
                          {moneyFmt.format(total)}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-odoo-surface-muted">
                          <div
                            className={
                              "h-full rounded-full " + rankBarBg(i)
                            }
                            style={{ width: `${Math.max(pct, 4).toFixed(1)}%` }}
                          />
                        </div>
                        <div className="font-mono text-[10px] font-semibold text-odoo-text-muted">
                          {numFmt.format(Number(r.orders))} ບິນ
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="ກິດຈະກຳຫຼ້າສຸດ" subtitle="8 ບິນລ່າສຸດ">
          {recentRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີ Order</EmptyHint>
          ) : (
            <ul className="relative space-y-3 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-odoo-border">
              {recentRows.map((r) => (
                <li key={r.cart_number} className="relative pl-6">
                  <span
                    className={
                      "absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm " +
                      statusDotBg(r.status)
                    }
                  />
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-odoo-text-strong">
                          {r.customer_name ?? "—"}
                        </span>
                        <span className="rounded bg-odoo-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-odoo-text-muted">
                          #{r.cart_number}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-odoo-text-muted">
                        {r.salesperson_name ?? "—"} ·{" "}
                        {timeFmt.format(new Date(r.create_date_time_now))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-odoo-text-strong">
                        {moneyFmt.format(Number(r.amount ?? 0))}
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {/* Quick links */}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink
          href="/orders/new"
          label="POS / ສ້າງບິນ"
          sub="ເລີ່ມຂາຍສິນຄ້າ"
          icon={<PosIcon />}
          accent="primary"
        />
        <QuickLink
          href="/cashier"
          label="ຮັບເງິນ"
          sub="ຊຳລະບິນລໍຖ້າ"
          icon={<CashIcon />}
          accent="warning"
        />
        <QuickLink
          href="/reports/daily-sales"
          label="ລາຍງານ"
          sub="ສະຫຼຸບການຂາຍ"
          icon={<ReportIcon />}
          accent="info"
        />
        <QuickLink
          href="/employees"
          label="ພະນັກງານ + ສິດ"
          sub="ຈັດການທີມ"
          icon={<UsersIcon />}
          accent="success"
        />
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

// Asia/Vientiane calendar date for an absolute moment. Returned as
// "YYYY-MM-DD" so we can subtract days and compare without local-TZ drift
// — the server's local TZ is irrelevant; we always work in Lao time.
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
    // Prisma maps DATE columns to a Date at UTC midnight of the date
    // string, so the UTC slice round-trips back to the same calendar day.
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
  // UTC midnight of today's Lao date — pairs cleanly with toISOString
  // (deterministic across server TZ) and renders identically under the
  // Asia/Vientiane formatter (same calendar day there too).
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

const KPI_ACCENT: Record<
  AccentName,
  { bar: string; iconBg: string; iconColor: string; ring: string }
> = {
  primary: {
    bar: "from-odoo-primary to-odoo-primary-light",
    iconBg: "bg-odoo-primary-50",
    iconColor: "text-odoo-primary",
    ring: "group-hover:ring-odoo-primary/30",
  },
  warning: {
    bar: "from-odoo-warning to-amber-300",
    iconBg: "bg-odoo-warning-bg",
    iconColor: "text-odoo-warning",
    ring: "group-hover:ring-odoo-warning/30",
  },
  success: {
    bar: "from-odoo-success to-emerald-400",
    iconBg: "bg-odoo-success-bg",
    iconColor: "text-odoo-success",
    ring: "group-hover:ring-odoo-success/30",
  },
  info: {
    bar: "from-odoo-info to-sky-300",
    iconBg: "bg-odoo-info-bg",
    iconColor: "text-odoo-info",
    ring: "group-hover:ring-odoo-info/30",
  },
};

function KpiCard({
  accent,
  label,
  value,
  unit,
  subtitle,
  delta,
  deltaLabel,
  href,
  icon,
}: {
  accent: AccentName;
  label: string;
  value: string;
  unit?: string;
  subtitle?: string;
  delta?: number | null;
  deltaLabel?: string;
  href?: string;
  icon?: React.ReactNode;
}) {
  const a = KPI_ACCENT[accent];
  const inner = (
    <div
      className={
        "group relative overflow-hidden rounded-xl border border-odoo-border bg-white p-4 shadow-sm ring-1 ring-transparent transition hover:shadow-md " +
        a.ring
      }
    >
      <span
        className={`absolute left-0 top-0 h-full w-1 bg-gradient-to-b ${a.bar}`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
          {label}
        </div>
        {icon ? (
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.iconBg} ${a.iconColor}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <div className="font-mono text-2xl font-bold tracking-tight text-odoo-text-strong">
          {value}
        </div>
        {unit ? (
          <div className="text-xs font-semibold text-odoo-text-muted">{unit}</div>
        ) : null}
      </div>
      {subtitle ? (
        <div className="mt-1 text-[11px] text-odoo-text-muted">{subtitle}</div>
      ) : null}
      {delta !== undefined && delta !== null ? (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <DeltaBadge delta={delta} />
          {deltaLabel ? (
            <span className="text-[10px] font-semibold text-odoo-text-muted">
              {deltaLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {href ? (
        <span className="absolute right-3 bottom-3 text-odoo-text-soft transition group-hover:translate-x-0.5 group-hover:text-odoo-primary">
          →
        </span>
      ) : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function DeltaBadge({ delta }: { delta: number }) {
  const positive = delta >= 0;
  return (
    <span
      className={
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold " +
        (positive ? "odoo-pill-success" : "odoo-pill-danger")
      }
    >
      {positive ? "▲" : "▼"}
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        {value ? (
          <span className="font-mono text-sm font-bold text-odoo-text-strong">
            {value}
          </span>
        ) : null}
        {delta !== undefined && delta !== null ? (
          <span
            className={
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold " +
              (delta >= 0 ? "odoo-pill-success" : "odoo-pill-danger")
            }
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        ) : delta === null ? (
          <span className="text-[10px] font-bold text-odoo-text-soft">—</span>
        ) : null}
        {sub ? (
          <span className="text-[11px] text-odoo-text-muted">· {sub}</span>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  link,
  children,
}: {
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-odoo-border bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-odoo-text-strong">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] text-odoo-text-muted">{subtitle}</p>
          ) : null}
        </div>
        {link ? (
          <Link
            href={link.href}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-odoo-primary transition hover:bg-odoo-primary-50"
          >
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
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
  const W = 700;
  const H = 180;
  const padX = 28;
  const padY = 24;
  const maxTotal = Math.max(1, ...series.map((d) => d.total));
  const stepX = (W - padX * 2) / Math.max(1, series.length - 1);

  const points = series.map((d, i) => {
    const x = padX + i * stepX;
    const y = padY + (H - padY * 2) * (1 - d.total / maxTotal);
    return { x, y, ...d };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    linePath +
    ` L ${points[points.length - 1].x.toFixed(1)} ${H - padY} L ${points[0].x.toFixed(1)} ${H - padY} Z`;

  return (
    <div className="-mx-2 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H + 24}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--odoo-primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--odoo-primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--odoo-primary)" />
            <stop offset="100%" stopColor="var(--odoo-accent)" />
          </linearGradient>
        </defs>

        {/* horizontal grid */}
        {[0.25, 0.5, 0.75].map((t) => {
          const y = padY + (H - padY * 2) * t;
          return (
            <line
              key={t}
              x1={padX}
              x2={W - padX}
              y1={y}
              y2={y}
              stroke="var(--odoo-border)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          );
        })}

        <path d={areaPath} fill="url(#area-grad)" />
        <path
          d={linePath}
          fill="none"
          stroke="url(#line-grad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.map((p) => (
          <g key={p.iso}>
            <circle
              cx={p.x}
              cy={p.y}
              r={p.isToday ? 5 : 3.5}
              fill="white"
              stroke="var(--odoo-primary)"
              strokeWidth={p.isToday ? 2.5 : 2}
            />
            {p.isToday ? (
              <circle
                cx={p.x}
                cy={p.y}
                r="10"
                fill="var(--odoo-primary)"
                opacity="0.15"
              />
            ) : null}
            <text
              x={p.x}
              y={p.y - 10}
              textAnchor="middle"
              className="font-mono"
              fontSize="9"
              fontWeight="700"
              fill={
                p.isToday ? "var(--odoo-primary)" : "var(--odoo-text-muted)"
              }
            >
              {p.total > 0 ? compactMoneyFmt.format(p.total) : ""}
            </text>
            <text
              x={p.x}
              y={H - 6}
              textAnchor="middle"
              fontSize="10"
              fontWeight={p.isToday ? "800" : "600"}
              fill={
                p.isToday ? "var(--odoo-primary)" : "var(--odoo-text-muted)"
              }
            >
              {dayShortFmt.format(p.date)}
            </text>
            <title>
              {dayShortFmt.format(p.date)} · {moneyFmt.format(p.total)} ກີບ ·{" "}
              {p.orders} ບິນ
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}

const ACTION_TONE: Record<
  "neutral" | "warning" | "danger" | "success",
  { bar: string; iconBg: string; iconColor: string; count: string }
> = {
  neutral: {
    bar: "bg-odoo-border",
    iconBg: "bg-odoo-surface-muted",
    iconColor: "text-odoo-text-muted",
    count: "text-odoo-text-strong",
  },
  warning: {
    bar: "bg-odoo-warning",
    iconBg: "bg-odoo-warning-bg",
    iconColor: "text-odoo-warning",
    count: "text-odoo-warning",
  },
  danger: {
    bar: "bg-odoo-danger",
    iconBg: "bg-odoo-danger-bg",
    iconColor: "text-odoo-danger",
    count: "text-odoo-danger",
  },
  success: {
    bar: "bg-odoo-success",
    iconBg: "bg-odoo-success-bg",
    iconColor: "text-odoo-success",
    count: "text-odoo-success",
  },
};

function ActionItem({
  label,
  count,
  amount,
  tone,
  href,
  sub,
  icon,
}: {
  label: string;
  count: number;
  amount?: number;
  tone: "neutral" | "warning" | "danger" | "success";
  href?: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  const t = ACTION_TONE[tone];
  const inner = (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-lg border border-odoo-border bg-white p-3 transition hover:border-odoo-primary-200 hover:shadow-sm">
      <span className={`absolute left-0 top-0 h-full w-0.5 ${t.bar}`} />
      {icon ? (
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.iconBg} ${t.iconColor}`}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-odoo-text-strong">
          {label}
        </div>
        {amount !== undefined ? (
          <div className="mt-0.5 font-mono text-[11px] text-odoo-text-muted">
            {moneyFmt.format(amount)} ກີບ
          </div>
        ) : sub ? (
          <div className="mt-0.5 truncate text-[11px] text-odoo-text-muted">
            {sub}
          </div>
        ) : null}
      </div>
      <div
        className={`font-mono text-2xl font-bold tabular-nums ${t.count}`}
      >
        {numFmt.format(count)}
      </div>
    </div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-odoo-border bg-odoo-surface-muted py-12 text-center text-xs font-semibold text-odoo-text-soft">
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: number | null }) {
  if (status === 1) {
    return (
      <span className="mt-0.5 inline-block rounded-full bg-odoo-success-bg px-2 py-0.5 text-[9px] font-bold text-odoo-success-text">
        ສຳເລັດ
      </span>
    );
  }
  if (status === 2) {
    return (
      <span className="mt-0.5 inline-block rounded-full bg-odoo-danger-bg px-2 py-0.5 text-[9px] font-bold text-odoo-danger-text">
        ຍົກເລີກ
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-block rounded-full bg-odoo-warning-bg px-2 py-0.5 text-[9px] font-bold text-odoo-warning-text">
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

function rankAvatarBg(i: number) {
  if (i === 0) return "bg-gradient-to-br from-amber-400 to-amber-600";
  if (i === 1) return "bg-gradient-to-br from-slate-300 to-slate-500";
  if (i === 2) return "bg-gradient-to-br from-orange-400 to-orange-600";
  return "bg-gradient-to-br from-odoo-primary to-odoo-primary-dark";
}

function rankBadgeBg(i: number) {
  if (i === 0) return "bg-amber-500 text-white";
  if (i === 1) return "bg-slate-400 text-white";
  if (i === 2) return "bg-orange-500 text-white";
  return "bg-odoo-primary text-white";
}

function rankBarBg(i: number) {
  if (i === 0)
    return "bg-gradient-to-r from-amber-400 to-amber-600";
  if (i === 1)
    return "bg-gradient-to-r from-slate-300 to-slate-500";
  if (i === 2)
    return "bg-gradient-to-r from-orange-400 to-orange-600";
  return "bg-gradient-to-r from-odoo-primary to-odoo-primary-light";
}

const QUICK_ACCENT: Record<
  AccentName,
  { bg: string; iconBg: string; iconColor: string }
> = {
  primary: {
    bg: "from-odoo-primary-50 to-white",
    iconBg: "bg-odoo-primary text-white",
    iconColor: "",
  },
  warning: {
    bg: "from-odoo-warning-bg to-white",
    iconBg: "bg-odoo-warning text-white",
    iconColor: "",
  },
  info: {
    bg: "from-odoo-info-bg to-white",
    iconBg: "bg-odoo-info text-white",
    iconColor: "",
  },
  success: {
    bg: "from-odoo-success-bg to-white",
    iconBg: "bg-odoo-success text-white",
    iconColor: "",
  },
};

function QuickLink({
  href,
  label,
  sub,
  icon,
  accent,
}: {
  href: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  accent: AccentName;
}) {
  const a = QUICK_ACCENT[accent];
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border border-odoo-border bg-gradient-to-br ${a.bg} p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ${a.iconBg}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-odoo-text-strong">
          {label}
        </div>
        {sub ? (
          <div className="mt-0.5 truncate text-[11px] text-odoo-text-muted">
            {sub}
          </div>
        ) : null}
      </div>
      <span className="text-odoo-text-soft transition group-hover:translate-x-0.5 group-hover:text-odoo-primary">
        →
      </span>
    </Link>
  );
}

function CashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}

function PosIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}
