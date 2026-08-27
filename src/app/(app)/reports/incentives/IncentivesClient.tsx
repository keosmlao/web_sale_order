"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

// ພິມ / PDF are still being shaped with the branch, so they stay off the
// deployed report and on in development. Set NEXT_PUBLIC_ENABLE_REPORT_PRINT=1
// to switch them on in production without touching this file — the value is
// read at build time, so a rebuild is needed for the change to take effect.
const SHOW_PRINT =
  process.env.NEXT_PUBLIC_ENABLE_REPORT_PRINT === "1" ||
  process.env.NODE_ENV !== "production";

// One programme that fed a row's ເງິນພິເສດ, with the condition it met.
type SpecialLine = {
  label: string;
  note: string;
  amount: number;
};

type IncentiveRow = {
  employeeCode: string;
  displayName: string;
  position?: string | null;
  groupCode: string;
  soldQty: number;
  salesAmount: number;
  targetPerPerson: number;
  achievementPct: number;
  bonusPoints: number;
  normalBonus: number;
  multiplier: number;
  netBonus: number;
  // ④/⑤ per-set spiffs — part of this person's pay.
  unitReward: number;
  // This person's share of a split ② department pot. Shown for explanation
  // only: a department reward is won by the storefront, not earned by a row,
  // so it is deliberately absent from totalPay.
  specialReward: number;
  specialLines?: SpecialLine[];
  commissionRate: number;
  commission: number;
  totalPay: number;
  // Only set on manager/head rows: per-group commission breakdown.
  commissionLines?: Array<{
    groupCode: string;
    base: number;
    achievementPct: number;
    rate: number;
    amount: number;
  }>;
};

type Tiers = {
  lowMaxPct: number;
  standardMaxPct: number;
  lowMultiplier: number;
  standardMultiplier: number;
  highMultiplier: number;
};

type BreakdownItem = {
  docDate: string;
  docNo: string | null;
  itemName: string | null;
  qty: number;
  price: number;
  unitPoints: number;
  points: number;
  salesAmount: number;
  noPointReason: string | null;
  /** The rule and multiplier behind the points; null when it scored nothing. */
  pointBasis: string | null;
};
type BreakdownBrand = {
  brand: string;
  points: number;
  salesAmount: number;
  qty: number;
  items: BreakdownItem[];
};
type BreakdownCategory = {
  category: string;
  label: string;
  points: number;
  salesAmount: number;
  qty: number;
  brands: BreakdownBrand[];
};
type Breakdown = {
  employeeCode: string;
  totalBills: number;
  totalLines: number;
  totalSales: number;
  totalPoints: number;
  categories: BreakdownCategory[];
};

type BreakdownBill = {
  docNo: string | null;
  docDate: string;
  qty: number;
  salesAmount: number;
  points: number;
  items: BreakdownItem[];
};

/**
 * Group a brand's lines back into the bills they were sold on — the level the
 * management report's drill-down stops at, so a point total can be traced to a
 * bill in either app.
 */
function billsOf(items: BreakdownItem[]): BreakdownBill[] {
  const bills = new Map<string, BreakdownBill>();
  for (const item of items) {
    const key = item.docNo ?? "—";
    const bill = bills.get(key)
      ?? { docNo: item.docNo, docDate: item.docDate, qty: 0, salesAmount: 0, points: 0, items: [] };
    bill.qty += item.qty;
    bill.salesAmount += item.salesAmount;
    bill.points += item.points;
    bill.items.push(item);
    bills.set(key, bill);
  }
  return [...bills.values()].sort(
    (a, b) => a.docDate.localeCompare(b.docDate) || (a.docNo ?? "").localeCompare(b.docNo ?? ""),
  );
}

type Report = {
  year: number;
  month: number;
  scope?: "all" | "self";
  currencyCode: string;
  tiers?: Tiers;
  commissionBase?: number;
  rows: IncentiveRow[];
  specialRewards?: SpecialRewardProgramme[];
  totalSales: number;
  totalBonus: number;
  totalUnitReward?: number;
  totalSpecial?: number;
  totalCommission?: number;
  totalPay?: number;
};

// A ② department programme and whether the storefront won it. The pot is a
// department figure — it is reported beside the table rather than inside it,
// because no row is paid out of it.
type SpecialRewardProgramme = {
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

const pct = (value: number) => `${Math.round(value * 100)}%`;

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const exactPctFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});
const exactPct = (value: number) => `${exactPctFmt.format(value * 100)}%`;

function currentPeriod(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

const REFRESH_MS = 45000;

export default function IncentivesClient() {
  const [period, setPeriod] = useState(currentPeriod);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfMenu, setPdfMenu] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Per-person point breakdown (tree view), lazy-loaded on row expand.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [breakdowns, setBreakdowns] = useState<Record<string, Breakdown>>({});
  const [bdLoading, setBdLoading] = useState<Set<string>>(new Set());

  const load = useCallback(async (silent = false) => {
    const [year, month] = period.split("-");
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year, month });
      const response = await fetch(`/api/reports/incentives?${params}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as Report & { error?: string };
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      setReport(data);
      setUpdatedAt(new Date().toLocaleTimeString("en-GB"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    Promise.resolve().then(() => void load());
  }, [load]);

  // Realtime: silently refresh on an interval and whenever the tab regains focus.
  useEffect(() => {
    const timer = setInterval(() => void load(true), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const rows = useMemo(
    () => [...(report?.rows ?? [])].sort((a, b) => b.totalPay - a.totalPay),
    [report],
  );
  // Managers (pos 11) / unit-heads (pos 12) are shown as their own cards, not in
  // the salespeople table — their pay is team-based commission, not personal sales.
  const bosses = useMemo(
    () => rows.filter((r) => r.position === "11" || r.position === "12"),
    [rows],
  );
  const sellers = useMemo(
    () => rows.filter((r) => r.position !== "11" && r.position !== "12"),
    [rows],
  );
  const sellerTotals = useMemo(
    () =>
      sellers.reduce(
        (a, r) => ({
          sales: a.sales + r.salesAmount,
          bonus: a.bonus + r.netBonus,
          unit: a.unit + r.unitReward,
          commission: a.commission + r.commission,
          pay: a.pay + r.totalPay,
        }),
        { sales: 0, bonus: 0, unit: 0, commission: 0, pay: 0 },
      ),
    [sellers],
  );

  const toggleRow = useCallback((empCode: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(empCode)) next.delete(empCode);
      else next.add(empCode);
      return next;
    });
    setBreakdowns((loaded) => {
      if (loaded[empCode]) return loaded;
      setBdLoading((prev) => {
        if (prev.has(empCode)) return prev;
        const [year, month] = period.split("-");
        void (async () => {
          try {
            const res = await fetch(
              `/api/reports/incentives/breakdown?year=${year}&month=${month}&emp=${encodeURIComponent(empCode)}`,
              { cache: "no-store" },
            );
            const data = (await res.json()) as Breakdown & { error?: string };
            if (res.ok) setBreakdowns((cur) => ({ ...cur, [empCode]: data }));
          } finally {
            setBdLoading((cur) => {
              const n = new Set(cur);
              n.delete(empCode);
              return n;
            });
          }
        })();
        return new Set(prev).add(empCode);
      });
      return loaded;
    });
  }, [period]);

  // A period change invalidates cached breakdowns.
  useEffect(() => {
    Promise.resolve().then(() => {
      setExpanded(new Set());
      setBreakdowns({});
    });
  }, [period]);
  const currency = report?.currencyCode ?? "THB";
  const tiers = report?.tiers;
  // The ④/⑤ column earns its width only when someone actually won a spiff.
  const hasSpecial = (report?.totalUnitReward ?? 0) > 0;
  const specialRewards = report?.specialRewards ?? [];
  const isSelf = report?.scope === "self";

  return (
    <div className="odoo-page incentive-print">
      <div className="odoo-page-header">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">Reports</div>
          <h1 className="odoo-page-title">{isSelf ? "ໂບນັດຂອງຂ້ອຍ" : "ໂບນັດພະນັກງານຂາຍ"}</h1>
          {/* Print-only line: the month is picked from a control that the
              printout hides, so state it on the page itself. */}
          <div className="incentive-print-period">
            ເດືອນ {period} · ສະກຸນ {currency}
          </div>
          <p className="odoo-page-subtitle flex flex-wrap items-center gap-x-2">
            <span>ຄຳນວນຈາກໃບຮັບເງິນຈິງ · ສະກຸນ {currency}</span>
            <span className="print:hidden inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE
            </span>
            {updatedAt ? <span className="text-[11px] text-odoo-text-muted">ອັບເດດ {updatedAt}</span> : null}
          </p>
        </div>
        <div className="odoo-card flex w-full gap-8 px-4 py-3 sm:w-auto">
          <Summary label="ຍອດຂາຍ" value={`${numberFmt.format(report?.totalSales ?? 0)} ${currency}`} />
          <Summary label="ໂບນັດ" value={`${numberFmt.format(report?.totalBonus ?? 0)} ${currency}`} />
          <Summary label="ລວມລາຍຮັບ" value={`${numberFmt.format(report?.totalPay ?? 0)} ${currency}`} accent />
        </div>
      </div>

      <section className="odoo-card p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid w-full gap-1 sm:w-auto">
            <span className="odoo-label">ເດືອນ</span>
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="odoo-input" />
          </label>
          <button type="button" onClick={() => void load()} className="odoo-btn odoo-btn-primary">ໂຫລດໃໝ່</button>
          {SHOW_PRINT ? (
          <>
          <button
            type="button"
            onClick={() => window.print()}
            className="odoo-btn"
            title="ພິມໜ້ານີ້ຕາມທີ່ເຫັນ"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 h-4 w-4">
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            ພິມ
          </button>
          {/* Two PDFs the branch asks for: the report exactly as shown, or a
              per-person sheet carrying the point breakdown behind each bonus. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPdfMenu((open) => !open)}
              aria-expanded={pdfMenu}
              className="odoo-btn"
              title="ບັນທຶກເປັນ PDF — ເລືອກແບບ"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 h-4 w-4">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 18v-6" />
                <path d="m9 15 3 3 3-3" />
              </svg>
              PDF ▾
            </button>
            {pdfMenu ? (
              <>
                <button
                  type="button"
                  aria-label="ປິດ"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setPdfMenu(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-odoo-border bg-white shadow-lg">
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left text-sm hover:bg-odoo-surface-muted"
                    onClick={() => { setPdfMenu(false); window.print(); }}
                  >
                    <div className="font-bold">ແບບ 1 · ໜ້າຈໍ</div>
                    <div className="text-xs text-odoo-text-muted">ຕາຕະລາງລວມ ຕາມທີ່ເຫັນໃນໜ້ານີ້</div>
                  </button>
                  <button
                    type="button"
                    className="block w-full border-t border-odoo-border px-3 py-2.5 text-left text-sm hover:bg-odoo-surface-muted"
                    onClick={() => {
                      setPdfMenu(false);
                      window.open(`/reports/incentives/pdf?period=${period}`, "_blank");
                    }}
                  >
                    <div className="font-bold">ແບບ 2 · ລາຍບຸກຄົນ</div>
                    <div className="text-xs text-odoo-text-muted">ແຍກເປັນຄົນ ພ້ອມລາຍລະອຽດຄະແນນ</div>
                  </button>
                </div>
              </>
            ) : null}
          </div>
          </>
          ) : null}
          <p className="text-xs text-odoo-text-muted sm:ml-auto">
            {tiers
              ? `ເກນຈ່າຍ: ≤${pct(tiers.lowMaxPct)} = ${pct(tiers.lowMultiplier)} · ${pct(tiers.lowMaxPct)}–${pct(tiers.standardMaxPct)} = ${pct(tiers.standardMultiplier)} · >${pct(tiers.standardMaxPct)} = ${pct(tiers.highMultiplier)}`
              : "ເກນຈ່າຍຕາມ % ຜົນງານ"}
          </p>
        </div>
      </section>

      {error ? <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      {isSelf ? (
        <SelfHero row={rows[0] ?? null} loading={loading} currency={currency} tiers={tiers} />
      ) : (
      <>
      {bosses.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {bosses.map((b) => <BossCard key={b.employeeCode} row={b} currency={currency} tiers={tiers} />)}
        </div>
      ) : null}
      <section className="odoo-card mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="odoo-table min-w-[980px]">
            <thead>
              <tr>
                <th className="px-3 py-3 text-center">#</th>
                <th className="px-4 py-3">ພະນັກງານ</th>
                <th className="px-3 py-3">ກຸ່ມ</th>
                <th className="px-3 py-3 text-right">ຈຳນວນ</th>
                <th className="px-3 py-3 text-right">ຍອດຂາຍ</th>
                <th className="px-3 py-3 text-right">ເປົ້າ/ຄົນ</th>
                <th className="px-3 py-3 text-right">ຜົນງານ</th>
                <th className="px-3 py-3 text-right">ຄະແນນສະສົມ</th>
                <th className="px-3 py-3 text-right">ຕົວຄູນ</th>
                <th className="px-3 py-3 text-right">① ໂບນັດ</th>
                {hasSpecial ? <th className="px-3 py-3 text-right">④ ລາງວັນຕໍ່ຊຸດ</th> : null}
                <th className="px-3 py-3 text-right">③ ຄ່າຄອມ</th>
                <th className="px-4 py-3 text-right">ລວມລາຍຮັບ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-odoo-border">
              {loading ? (
                <tr><td colSpan={hasSpecial ? 13 : 12} className="px-4 py-12 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
              ) : sellers.length === 0 ? (
                <tr><td colSpan={hasSpecial ? 13 : 12} className="px-4 py-12 text-center text-odoo-text-muted">ບໍ່ມີຍອດຂາຍໃນເດືອນນີ້</td></tr>
              ) : sellers.map((row, index) => {
                const isBoss = false;
                const isOpen = expanded.has(row.employeeCode);
                const colCount = hasSpecial ? 13 : 12;
                return (
                <Fragment key={`${row.employeeCode}-${row.groupCode}`}>
                <tr
                  className={isBoss ? undefined : "cursor-pointer hover:bg-odoo-surface-muted"}
                  onClick={isBoss ? undefined : () => toggleRow(row.employeeCode)}
                >
                  <td className="px-3 py-3 text-center font-mono text-odoo-text-muted">
                    <span className="inline-flex items-center gap-1">
                      {isBoss ? <span className="inline-block w-3" /> : <Chevron open={isOpen} />}
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3"><div className="font-bold text-odoo-text-strong">{row.displayName}</div><div className="font-mono text-[10px] text-odoo-text-muted">{row.employeeCode}</div></td>
                  <td className="px-3 py-3">{(() => {
                    const chip =
                      row.position === "11"
                        ? { label: "ຜູ້ຈັດການ", cls: "bg-violet-100 text-violet-700" }
                        : row.position === "12"
                          ? { label: "ຫົວໜ້າ", cls: "bg-amber-100 text-amber-700" }
                          : row.groupCode === "AIR"
                            ? { label: "AIR", cls: "bg-sky-100 text-sky-700" }
                            : { label: "CE + SDA", cls: "bg-emerald-100 text-emerald-700" };
                    return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>;
                  })()}</td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.soldQty)}</td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.salesAmount)}</td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.targetPerPerson)}</td>
                  <td className="px-3 py-3 text-right"><Achievement value={row.achievementPct} tiers={tiers} /></td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.bonusPoints)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold">×{row.multiplier.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-odoo-text-strong">{numberFmt.format(row.netBonus)}</td>
                  {hasSpecial ? <td className="px-3 py-3 text-right font-mono">{row.unitReward > 0 ? numberFmt.format(row.unitReward) : "—"}</td> : null}
                  <td className="px-3 py-3 text-right font-mono">{row.commission > 0 ? numberFmt.format(row.commission) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{numberFmt.format(row.totalPay)} {currency}</td>
                </tr>
                {isOpen && !isBoss ? (
                  <tr>
                    <td colSpan={colCount} className="bg-odoo-surface-muted/40 p-0">
                      <BreakdownTree
                        data={breakdowns[row.employeeCode]}
                        loading={bdLoading.has(row.employeeCode)}
                        currency={currency}
                        specialLines={row.specialLines}
                        specialTotal={row.unitReward + row.specialReward}
                      />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
                );
              })}
            </tbody>
            {!loading && sellers.length > 0 ? (
              <tfoot><tr className="border-t-2 border-odoo-border bg-odoo-surface-muted font-bold"><td colSpan={4} className="px-4 py-3">ລວມ</td><td className="px-3 py-3 text-right font-mono">{numberFmt.format(sellerTotals.sales)}</td><td colSpan={4} /><td className="px-3 py-3 text-right font-mono text-odoo-text-strong">{numberFmt.format(sellerTotals.bonus)}</td>{hasSpecial ? <td className="px-3 py-3 text-right font-mono">{numberFmt.format(sellerTotals.unit)}</td> : null}<td className="px-3 py-3 text-right font-mono">{numberFmt.format(sellerTotals.commission)}</td><td className="px-4 py-3 text-right font-mono text-emerald-700">{numberFmt.format(sellerTotals.pay)} {currency}</td></tr></tfoot>
            ) : null}
          </table>
        </div>
      </section>

      {/* ② ເງິນພິເສດ — the storefront's own pots, deliberately outside the
          table above: they are won by the whole department against its monthly
          total, not earned by a row, so adding them to anyone's pay would read
          as money each person receives. */}
      {specialRewards.length > 0 ? (
        <section className="odoo-card mt-4 p-4">
          <h3 className="card-title">② ເງິນພິເສດ (ລາງວັນທັງພະແນກ)</h3>
          <p className="mt-1 text-[11px] text-odoo-text-muted">
            ວັດຈາກຍອດຂາຍລວມຂອງຄົນທີ່ມີເປົ້າ — ບໍ່ໄດ້ລວມຢູ່ໃນ “ລວມລາຍຮັບ” ຂອງແຕ່ລະຄົນ
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="odoo-table min-w-[720px]">
              <thead>
                <tr>
                  <th className="px-4 py-2">ລາງວັນ</th>
                  <th className="px-3 py-2">ກຸ່ມ</th>
                  <th className="px-3 py-2 text-right">ເປົ້າ</th>
                  <th className="px-3 py-2 text-right">ຍອດຈິງ</th>
                  <th className="px-3 py-2 text-right">ບັນລຸ</th>
                  <th className="px-4 py-2 text-right">ເງິນລາງວັນ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-odoo-border">
                {specialRewards.map((reward) => (
                  <tr key={reward.code}>
                    <td className="px-4 py-2 font-bold text-odoo-text-strong">
                      {reward.description}
                      {reward.splitByShare ? (
                        <span className="ml-2 text-[11px] font-semibold text-odoo-text-muted">ແບ່ງຕາມ % ຍອດ</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{reward.groupCode}</td>
                    <td className="px-3 py-2 text-right font-mono">{numberFmt.format(reward.targetAmount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{numberFmt.format(reward.actualAmount)}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                          reward.achieved ? "bg-emerald-100 text-emerald-700" : "bg-odoo-surface-muted text-odoo-text-muted"
                        }`}
                      >
                        {pct(reward.achievementPct)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-black text-amber-600">
                      {reward.achieved ? `${numberFmt.format(reward.rewardAmount)} ${currency}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      </>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 shrink-0 text-odoo-text-muted transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CAT_CHIP: Record<string, string> = {
  Air: "bg-sky-100 text-sky-700",
  REF: "bg-emerald-100 text-emerald-700",
  Washer: "bg-teal-100 text-teal-700",
  AV: "bg-indigo-100 text-indigo-700",
  SDA: "bg-amber-100 text-amber-700",
};

// Bill audit: every qualifying line behind the employee's incentive row,
// including zero-point products. Sorting by date/bill keeps multi-line bills
// together and makes the detail directly reconcilable to the sales total.
function BreakdownTree({
  data,
  loading,
  currency,
  specialLines = [],
  specialTotal = 0,
}: {
  data?: Breakdown;
  loading: boolean;
  currency: string;
  specialLines?: SpecialLine[];
  specialTotal?: number;
}) {
  if (loading && !data) return <div className="px-10 py-4 text-sm text-odoo-text-muted">ກຳລັງໂຫລດລາຍລະອຽດ…</div>;
  if (!data) return null;
  const hasItems = data.categories.some((cat) => cat.brands.some((brand) => brand.items.length > 0));
  if (!hasItems) return <div className="px-10 py-4 text-sm text-odoo-text-muted">ບໍ່ມີບິນໃນເດືອນນີ້</div>;
  return (
    <div className="border-l-2 border-odoo-primary/30 py-3 pl-8 pr-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-bold text-odoo-text-strong">ທຸກບິນທີ່ນຳມາຄຳນວນ</span>
        <span className="text-odoo-text-muted">{numberFmt.format(data.totalBills)} ບິນ</span>
        <span className="text-odoo-text-muted">{numberFmt.format(data.totalLines)} ລາຍການ</span>
        <span className="ml-auto font-mono font-bold text-odoo-text-strong">
          ຍອດຂາຍ {numberFmt.format(data.totalSales)} {currency}
        </span>
      </div>
      {/* ໝວດ → ຍີ່ຫໍ້ → ບິນ → ລາຍການ, the same drill-down the management
          report uses, so a figure can be traced the same way in both. */}
      <div className="max-h-[520px] space-y-1 overflow-auto rounded border border-odoo-border bg-white p-2">
        {data.categories.map((cat) => (
          <details key={cat.category} className="rounded border border-odoo-border/60">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs hover:bg-odoo-surface-muted">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${CAT_CHIP[cat.category] ?? "bg-slate-100 text-slate-700"}`}>
                {cat.label}
              </span>
              {/* The point map is keyed by this code, not by the ERP category
                  name, so show it — it is what to check when a line scores 0. */}
              <span className="font-mono text-odoo-text-muted">{cat.category}</span>
              <span className="font-mono text-odoo-text-muted">
                {cat.brands.length} ຍີ່ຫໍ້ · {numberFmt.format(cat.qty)} ໜ່ວຍ
              </span>
              <span className="ml-auto font-mono font-bold text-odoo-primary">
                {numberFmt.format(cat.points)} ຄະແນນ
              </span>
            </summary>
            <div className="space-y-1 border-t border-odoo-border/60 p-1.5 pl-4">
              {cat.brands.map((brand) => {
                const bills = billsOf(brand.items);
                return (
                  <details key={brand.brand} className="rounded border border-odoo-border/40">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs hover:bg-odoo-surface-muted">
                      <span className="font-semibold text-odoo-text-strong">{brand.brand}</span>
                      <span className="font-mono text-odoo-text-muted">
                        {bills.length} ບິນ · {brand.items.length} ລາຍການ · {numberFmt.format(brand.qty)} ໜ່ວຍ
                      </span>
                      <span className="ml-auto font-mono font-bold text-odoo-primary">
                        {numberFmt.format(brand.points)} ຄະແນນ
                      </span>
                    </summary>
                    <div className="space-y-1 border-t border-odoo-border/40 p-1.5 pl-4">
                      {bills.map((bill) => (
                        <details key={bill.docNo} className="rounded border border-odoo-border/30">
                          <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-xs hover:bg-odoo-surface-muted">
                            <span className="font-mono text-odoo-text-muted">{bill.docDate}</span>
                            <span className="font-mono font-semibold text-odoo-text-strong">{bill.docNo ?? "—"}</span>
                            <span className="font-mono text-odoo-text-muted">
                              {bill.items.length} ລາຍການ · {numberFmt.format(bill.qty)} ໜ່ວຍ · {numberFmt.format(bill.salesAmount)}
                            </span>
                            <span className="ml-auto font-mono font-bold text-odoo-primary">
                              {numberFmt.format(bill.points)} ຄະແນນ
                            </span>
                          </summary>
                          <div className="overflow-x-auto border-t border-odoo-border/30">
                            <table className="w-full min-w-[720px] text-xs">
                              <thead className="bg-odoo-surface-muted text-odoo-text-muted">
                                <tr>
                                  <th className="px-2 py-1.5 text-left font-semibold">ສິນຄ້າ</th>
                                  <th className="px-2 py-1.5 text-right font-semibold">ຈຳນວນ</th>
                                  <th className="px-2 py-1.5 text-right font-semibold">ຄະແນນ/ໜ່ວຍ</th>
                                  <th className="px-2 py-1.5 text-right font-semibold">ຄະແນນ</th>
                                  <th className="px-2 py-1.5 text-left font-semibold">ເງື່ອນໄຂຄະແນນ</th>
                                  <th className="px-2 py-1.5 text-right font-semibold">ຍອດຂາຍ</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-odoo-border/50">
                                {bill.items.map((item, index) => (
                                  <tr
                                    key={`${item.docNo}-${item.itemName}-${index}`}
                                    className={item.points === 0 ? "bg-slate-50 text-odoo-text-muted" : "text-odoo-text-strong"}
                                  >
                                    <td className="px-2 py-1.5">{item.itemName ?? "—"}</td>
                                    <td className="px-2 py-1.5 text-right font-mono">{numberFmt.format(item.qty)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono">{numberFmt.format(item.unitPoints)}</td>
                                    <td className={`px-2 py-1.5 text-right font-mono font-bold ${item.points === 0 ? "text-slate-400" : "text-odoo-primary"}`}>
                                      {numberFmt.format(item.points)}
                                    </td>
                                    <td className={`max-w-[360px] px-2 py-1.5 ${item.noPointReason ? "text-amber-700" : "text-odoo-text-muted"}`}>
                                      {item.noPointReason ?? item.pointBasis ?? "—"}
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono">{numberFmt.format(item.salesAmount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 text-sm">
        <span className="text-odoo-text-muted">ລວມຄະແນນ:</span>
        <span className="font-mono font-black text-odoo-primary">{numberFmt.format(data.totalPoints)}</span>
        <span className="text-odoo-text-muted">· × 10 {currency}/ຄະແນນ × ຕົວຄູນ = ໂບນັດ</span>
      </div>

      {/* Rewards outside the points are a sum of separate programmes, so name
          what produced each one — one compact right-aligned line each,
          matching the points line above. */}
      {specialLines.map((line, i) => (
        <div key={`${line.label}-${i}`} className="flex items-center justify-end gap-2 pt-1 text-sm">
          <span className="text-odoo-text-muted">ລາງວັນ:</span>
          <span className="font-mono font-black text-amber-600">{numberFmt.format(line.amount)}</span>
          <span className="text-odoo-text-muted">· {line.note}</span>
        </div>
      ))}
      {specialLines.length > 1 ? (
        <div className="flex items-center justify-end gap-2 pt-1 text-sm">
          <span className="text-odoo-text-muted">ລວມລາງວັນ:</span>
          <span className="font-mono font-black text-amber-600">
            {numberFmt.format(specialTotal)} {currency}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// Manager (pos 11) / unit-head (pos 12) — own card showing team-based commission,
// broken down per product group (base × pay-rate on that group's achievement).
function BossCard({ row, currency, tiers }: { row: IncentiveRow; currency: string; tiers?: Tiers }) {
  const chip =
    row.position === "11"
      ? { label: "ຜູ້ຈັດການ", cls: "bg-violet-100 text-violet-700" }
      : { label: "ຫົວໜ້າໜ່ວຍງານ", cls: "bg-amber-100 text-amber-700" };
  const groupLabel = (g: string) => (g === "AIR" ? "AIR" : g === "CE_SDA" ? "CE + SDA" : "ທັງໝົດ");
  const lines = row.commissionLines ?? [];
  return (
    <div className="odoo-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>
          <div className="mt-1.5 font-bold text-odoo-text-strong">{row.displayName}</div>
          <div className="font-mono text-[10px] text-odoo-text-muted">{row.employeeCode}</div>
        </div>
        <div className="text-right">
          <div className="odoo-label mb-0.5">ລວມຄ່າຄອມ</div>
          <div className="font-mono text-2xl font-black text-emerald-700">{numberFmt.format(row.commission)}</div>
          <div className="text-xs text-odoo-text-muted">{currency}</div>
        </div>
      </div>
      {lines.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[380px] text-xs">
            <thead>
              <tr className="text-odoo-text-muted">
                <th className="px-2 py-1 text-left font-semibold">ໝວດ</th>
                <th className="px-2 py-1 text-right font-semibold">ເລດພື້ນຖານ</th>
                <th className="px-2 py-1 text-right font-semibold">ຜົນງານ</th>
                <th className="px-2 py-1 text-right font-semibold">ເລດຈ່າຍ</th>
                <th className="px-2 py-1 text-right font-semibold">ຄ່າຄອມ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-odoo-border/50">
              {lines.map((l) => (
                <tr key={l.groupCode} className="text-odoo-text-strong">
                  <td className="px-2 py-1">{groupLabel(l.groupCode)}</td>
                  <td className="px-2 py-1 text-right font-mono">{numberFmt.format(l.base)}</td>
                  <td className="px-2 py-1 text-right"><Achievement value={l.achievementPct} tiers={tiers} /></td>
                  <td className="px-2 py-1 text-right font-mono">{exactPct(l.rate)}</td>
                  <td className="px-2 py-1 text-right font-mono font-bold">{numberFmt.format(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function SelfHero({ row, loading, currency, tiers }: { row: IncentiveRow | null; loading: boolean; currency: string; tiers?: Tiers }) {
  if (loading && !row) return <div className="odoo-card mt-4 p-8 text-center text-sm text-odoo-text-muted">ກຳລັງໂຫລດ…</div>;
  if (!row) return <div className="odoo-card mt-4 p-8 text-center text-sm text-odoo-text-muted">ຍັງບໍ່ມີເປົ້າ/ຍອດຂາຍໃນເດືອນນີ້</div>;
  const achColor = row.achievementPct > (tiers?.standardMaxPct ?? 1) ? "text-emerald-700" : row.achievementPct > (tiers?.lowMaxPct ?? 0.5) ? "text-odoo-primary" : "text-amber-700";
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <div className="odoo-card flex flex-col justify-between gap-4 bg-gradient-to-br from-emerald-600 to-emerald-700 p-6 text-white lg:col-span-1">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-emerald-100">ລວມລາຍຮັບເດືອນນີ້</div>
          <div className="mt-1 font-mono text-4xl font-black">{numberFmt.format(row.totalPay)}</div>
          <div className="text-sm text-emerald-100">{currency}</div>
        </div>
        <div className="text-sm text-emerald-50">{row.displayName} · {row.groupCode === "AIR" ? "AIR" : "CE + SDA"}</div>
      </div>
      <div className="odoo-card grid grid-cols-2 gap-4 p-6 lg:col-span-2 sm:grid-cols-3">
        <Metric label="① ໂບນັດ" value={`${numberFmt.format(row.netBonus)} ${currency}`} />
        {row.unitReward > 0 ? <Metric label="④ ລາງວັນຕໍ່ຊຸດ" value={`${numberFmt.format(row.unitReward)} ${currency}`} /> : null}
        <Metric label="③ ຄ່າຄອມ" value={row.commission > 0 ? `${numberFmt.format(row.commission)} ${currency}` : "—"} />
        <Metric label="ຍອດຂາຍ" value={`${numberFmt.format(row.salesAmount)}`} />
        <Metric label="ເປົ້າ/ຄົນ" value={`${numberFmt.format(row.targetPerPerson)}`} />
        <Metric label="ຜົນງານ" value={exactPct(row.achievementPct)} valueClass={achColor} />
        <Metric label="ຈຳນວນຂາຍ" value={numberFmt.format(row.soldQty)} />
        <Metric label="ຕົວຄູນໂບນັດ" value={`×${row.multiplier.toFixed(1)}`} />
      </div>
    </div>
  );
}

function Metric({ label, value, valueClass = "text-odoo-text-strong" }: { label: string; value: string; valueClass?: string }) {
  return <div><div className="odoo-label mb-1">{label}</div><div className={`whitespace-nowrap font-mono text-lg font-black ${valueClass}`}>{value}</div></div>;
}

function Summary({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div><div className="odoo-label mb-1">{label}</div><div className={`whitespace-nowrap font-mono text-xl font-black ${accent ? "text-emerald-700" : "text-odoo-primary"}`}>{value}</div></div>;
}

function Achievement({ value, tiers }: { value: number; tiers?: Tiers }) {
  const standardMax = tiers?.standardMaxPct ?? 1;
  const lowMax = tiers?.lowMaxPct ?? 0.5;
  const color = value > standardMax ? "text-emerald-700" : value > lowMax ? "text-odoo-primary" : "text-amber-700";
  return <span className={`font-mono font-bold ${color}`}>{exactPct(value)}</span>;
}
