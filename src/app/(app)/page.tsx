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
});

const dayShortFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
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
      // Last 7 days of sales — drives the inline bar chart. We zero-fill
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

  // Build the last-7-days series with zero-filled gaps so the chart spans
  // a full week regardless of which days had sales.
  const dailySeries = buildDailySeries(dailyRows);
  const maxDailyTotal = Math.max(1, ...dailySeries.map((d) => d.total));

  const topTotal = Number(topRows[0]?.total ?? 0);

  const priceCounts = priceCountRows[0];
  const pendingPriceRequests = Number(priceCounts?.pending ?? 0);
  const approvedPricesToday = Number(priceCounts?.approved_today ?? 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Greeting + date */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-odoo-primary">
            ສະບາຍດີ
          </div>
          <h1 className="mt-1 text-2xl font-bold text-odoo-text-strong sm:text-3xl">
            {greeting}
          </h1>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
            ມື້ນີ້
          </div>
          <div className="text-sm font-semibold text-odoo-text-strong">
            {new Date().toLocaleDateString("lo-LA", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>
      </header>

      {/* KPI cards */}
      <section className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          accent="primary"
          label="ຍອດຂາຍມື້ນີ້"
          value={moneyFmt.format(todayTotal)}
          unit="ກີບ"
          subtitle={`${numFmt.format(todayOrders)} ບິນ`}
          delta={totalDeltaPct}
          deltaLabel="vs ມື້ວານ"
        />
        <KpiCard
          accent="warning"
          label="ລໍຖ້າຮັບເງິນ"
          value={moneyFmt.format(today.pendingAmount)}
          unit="ກີບ"
          subtitle={`${numFmt.format(today.pendingCount)} ບິນ · ກົດເພື່ອຮັບເງິນ`}
          href="/cashier"
        />
        <KpiCard
          accent="success"
          label="ສະເລ່ຍ/ບິນ"
          value={moneyFmt.format(avg)}
          unit="ກີບ"
          subtitle={`${numFmt.format(today.completedCount)} ບິນຮັບເງິນແລ້ວ`}
        />
        <KpiCard
          accent="info"
          label="ຍອດເດືອນນີ້"
          value={moneyFmt.format(monthTotal)}
          unit="ກີບ"
          subtitle={`${numFmt.format(monthOrders)} ບິນ`}
          href="/reports/salespeople"
        />
      </section>

      {/* 7-day chart + action items side by side */}
      <section className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel
          title="ຍອດຂາຍ 7 ວັນຍ້ອນຫຼັງ"
          link={{ href: "/reports/daily-sales", label: "ລາຍງານລະອຽດ →" }}
        >
          <div className="grid grid-cols-7 items-end gap-2 px-1 pt-3">
            {dailySeries.map((d) => {
              const heightPct = (d.total / maxDailyTotal) * 100;
              const isToday = d.isToday;
              return (
                <div
                  key={d.iso}
                  className="flex flex-col items-center gap-1.5"
                  title={`${dayShortFmt.format(d.date)} · ${moneyFmt.format(d.total)} ກີບ · ${d.orders} ບິນ`}
                >
                  <div className="font-mono text-[10px] font-semibold text-odoo-text-muted">
                    {d.total > 0 ? compactMoneyFmt.format(d.total) : "—"}
                  </div>
                  <div className="flex h-32 w-full items-end overflow-hidden rounded-md bg-odoo-surface-muted">
                    <div
                      className={
                        "w-full rounded-md transition-all " +
                        (isToday ? "bg-odoo-primary" : "bg-odoo-primary/50")
                      }
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    />
                  </div>
                  <div
                    className={
                      "text-[10px] font-bold uppercase " +
                      (isToday ? "text-odoo-primary" : "text-odoo-text-muted")
                    }
                  >
                    {dayShortFmt.format(d.date)}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="ລາຍການດ່ວນ">
          <ul className="divide-y divide-odoo-border">
            <ActionItem
              label="ບິນລໍຖ້າຊຳລະ"
              count={today.pendingCount}
              amount={today.pendingAmount}
              tone={today.pendingCount > 0 ? "warning" : "neutral"}
              href="/cashier"
            />
            {canSeePriceRequests ? (
              <ActionItem
                label="ຄຳຂໍລາຄາພິເສດ"
                count={pendingPriceRequests}
                tone={pendingPriceRequests > 0 ? "danger" : "neutral"}
                sub={`ອະນຸມັດແລ້ວວັນນີ້: ${approvedPricesToday}`}
              />
            ) : (
              <ActionItem
                label="ລາຄາພິເສດອະນຸມັດແລ້ວ"
                count={approvedPricesToday}
                tone="success"
                href="/cashier"
                sub="ກວດສອບໃນໜ້າຮັບເງິນ"
              />
            )}
            {today.cancelledCount > 0 ? (
              <ActionItem
                label="ບິນຍົກເລີກວັນນີ້"
                count={today.cancelledCount}
                amount={today.cancelledAmount}
                tone="danger"
              />
            ) : null}
          </ul>
        </Panel>
      </section>

      {/* Compare strip */}
      <section className="odoo-card mt-4 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <Stat
            label="ມື້ວານ"
            value={`${moneyFmt.format(yesterdayTotal)} ກີບ`}
            sub={`${numFmt.format(yesterdayOrders)} ບິນ`}
          />
          <div className="h-6 w-px bg-odoo-border" />
          <Stat label="ບິນ ມື້ນີ້ vs ມື້ວານ" value="" delta={ordersDeltaPct} />
          <Stat label="ຍອດ ມື້ນີ້ vs ມື້ວານ" value="" delta={totalDeltaPct} />
        </div>
      </section>

      {/* Top salespeople + recent activity */}
      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Panel
          title="Top ພະນັກງານຂາຍ ມື້ນີ້"
          link={{ href: "/reports/salespeople", label: "ເບິ່ງລາຍງານທັງໝົດ →" }}
        >
          {topRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີຍອດຂາຍວັນນີ້</EmptyHint>
          ) : (
            <ul className="divide-y divide-odoo-border">
              {topRows.map((r, i) => {
                const total = Number(r.total ?? 0);
                const pct = topTotal > 0 ? (total / topTotal) * 100 : 0;
                const name =
                  r.fullname_lo?.trim() ||
                  r.nickname?.trim() ||
                  r.user_owner ||
                  "ບໍ່ລະບຸ";
                return (
                  <li key={(r.user_owner ?? "") + i} className="flex items-center gap-3 py-3">
                    <div
                      className={
                        "flex h-8 w-8 items-center justify-center rounded-full font-mono text-xs font-bold " +
                        (i === 0
                          ? "bg-odoo-primary text-white"
                          : i === 1
                            ? "bg-odoo-primary-100 text-odoo-primary"
                            : "bg-odoo-surface-muted text-odoo-text-muted")
                      }
                    >
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate font-semibold text-odoo-text-strong">
                          {name}
                        </div>
                        <div className="font-mono text-sm font-bold text-odoo-text-strong">
                          {moneyFmt.format(total)}
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-odoo-surface-muted">
                          <div
                            className="h-full bg-odoo-primary"
                            style={{ width: `${pct.toFixed(1)}%` }}
                          />
                        </div>
                        <div className="font-mono text-[10px] text-odoo-text-muted">
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

        <Panel title="ກິດຈະກຳຫຼ້າສຸດ">
          {recentRows.length === 0 ? (
            <EmptyHint>ຍັງບໍ່ມີ Order</EmptyHint>
          ) : (
            <ul className="divide-y divide-odoo-border">
              {recentRows.map((r) => (
                <li key={r.cart_number} className="py-2.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusDot status={r.status} />
                        <span className="truncate font-semibold text-odoo-text-strong">
                          {r.customer_name ?? "—"}
                        </span>
                        <span className="font-mono text-[10px] text-odoo-text-soft">
                          #{r.cart_number}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-odoo-text-muted">
                        {r.salesperson_name ?? "—"} ·{" "}
                        {timeFmt.format(new Date(r.create_date_time_now))}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-bold text-odoo-text-strong">
                      {moneyFmt.format(Number(r.amount ?? 0))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {/* Quick links */}
      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QuickLink href="/orders/new" label="POS / ສ້າງບິນ" icon={<PosIcon />} />
        <QuickLink href="/cashier" label="ຮັບເງິນ" icon={<CashIcon />} />
        <QuickLink href="/reports/daily-sales" label="ລາຍງານ" icon={<ReportIcon />} />
        <QuickLink href="/employees" label="ພະນັກງານ + ສິດ" icon={<UsersIcon />} />
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
  const todayIso = new Date().toISOString().slice(0, 10);
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const iso = d.toISOString().slice(0, 10);
    const m = map.get(iso) ?? { total: 0, orders: 0 };
    series.push({
      iso,
      date: d,
      total: m.total,
      orders: m.orders,
      isToday: iso === todayIso,
    });
  }
  return series;
}

type AccentName = "primary" | "warning" | "success" | "info";

const ACCENT_BAR: Record<AccentName, string> = {
  primary: "bg-odoo-primary",
  warning: "bg-odoo-warning",
  success: "bg-odoo-success",
  info: "bg-odoo-info",
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
}: {
  accent: AccentName;
  label: string;
  value: string;
  unit?: string;
  subtitle?: string;
  delta?: number | null;
  deltaLabel?: string;
  href?: string;
}) {
  const inner = (
    <div className="odoo-card group relative overflow-hidden p-4 transition hover:border-odoo-primary">
      <span className={`absolute left-0 top-0 h-full w-1 ${ACCENT_BAR[accent]}`} />
      <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
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
        <div className="mt-2 flex items-center gap-1 text-xs font-bold">
          <DeltaBadge delta={delta} />
          {deltaLabel ? (
            <span className="text-[10px] font-semibold text-odoo-text-muted">
              {deltaLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {href ? (
        <span className="absolute right-3 top-3 text-odoo-text-soft transition group-hover:text-odoo-primary">
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
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold " +
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
      <div className="mt-0.5 flex items-baseline gap-2">
        {value ? (
          <span className="font-mono text-sm font-bold text-odoo-text-strong">
            {value}
          </span>
        ) : null}
        {delta !== undefined && delta !== null ? (
          <span
            className={
              "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-bold " +
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
  link,
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="odoo-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-odoo-text-strong">
          {title}
        </h2>
        {link ? (
          <Link
            href={link.href}
            className="text-[11px] font-semibold text-odoo-primary hover:underline"
          >
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ActionItem({
  label,
  count,
  amount,
  tone,
  href,
  sub,
}: {
  label: string;
  count: number;
  amount?: number;
  tone: "neutral" | "warning" | "danger" | "success";
  href?: string;
  sub?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "text-odoo-danger"
      : tone === "warning"
        ? "text-odoo-warning"
        : tone === "success"
          ? "text-odoo-success"
          : "text-odoo-text-muted";
  const inner = (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
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
      <div className={"font-mono text-2xl font-bold tabular-nums " + toneClass}>
        {numFmt.format(count)}
      </div>
    </div>
  );
  return href ? (
    <li>
      <Link
        href={href}
        className="block rounded-md px-2 transition hover:bg-odoo-surface-muted"
      >
        {inner}
      </Link>
    </li>
  ) : (
    <li className="px-2">{inner}</li>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-10 text-center text-xs text-odoo-text-soft">{children}</div>
  );
}

function StatusDot({ status }: { status: number | null }) {
  const color =
    status === 1
      ? "bg-odoo-success"
      : status === 2
        ? "bg-odoo-danger"
        : "bg-odoo-warning";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function QuickLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="odoo-card flex items-center gap-3 p-3 transition hover:border-odoo-primary hover:bg-odoo-primary-50"
    >
      <span className="text-odoo-primary">{icon}</span>
      <span className="font-semibold text-odoo-text-strong">{label}</span>
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
