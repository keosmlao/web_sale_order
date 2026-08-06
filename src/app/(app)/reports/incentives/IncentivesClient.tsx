"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

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
  specialReward: number;
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
  totalPoints: number;
  categories: BreakdownCategory[];
};

type Report = {
  year: number;
  month: number;
  scope?: "all" | "self";
  currencyCode: string;
  tiers?: Tiers;
  commissionBase?: number;
  rows: IncentiveRow[];
  totalSales: number;
  totalBonus: number;
  totalSpecial?: number;
  totalCommission?: number;
  totalPay?: number;
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
          special: a.special + r.specialReward,
          commission: a.commission + r.commission,
          pay: a.pay + r.totalPay,
        }),
        { sales: 0, bonus: 0, special: 0, commission: 0, pay: 0 },
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
  const hasSpecial = (report?.totalSpecial ?? 0) > 0;
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
          <button
            type="button"
            onClick={() => window.print()}
            className="odoo-btn"
            title="ເປີດໜ້າຕ່າງພິມ — ເລືອກ 'Save as PDF' ເພື່ອບັນທຶກເປັນໄຟລ໌"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 h-4 w-4">
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            ພິມ / PDF
          </button>
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
                {hasSpecial ? <th className="px-3 py-3 text-right">② ເງິນພິເສດ</th> : null}
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
                  {hasSpecial ? <td className="px-3 py-3 text-right font-mono">{row.specialReward > 0 ? numberFmt.format(row.specialReward) : "—"}</td> : null}
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
                      />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
                );
              })}
            </tbody>
            {!loading && sellers.length > 0 ? (
              <tfoot><tr className="border-t-2 border-odoo-border bg-odoo-surface-muted font-bold"><td colSpan={4} className="px-4 py-3">ລວມ</td><td className="px-3 py-3 text-right font-mono">{numberFmt.format(sellerTotals.sales)}</td><td colSpan={4} /><td className="px-3 py-3 text-right font-mono text-odoo-text-strong">{numberFmt.format(sellerTotals.bonus)}</td>{hasSpecial ? <td className="px-3 py-3 text-right font-mono">{numberFmt.format(sellerTotals.special)}</td> : null}<td className="px-3 py-3 text-right font-mono">{numberFmt.format(sellerTotals.commission)}</td><td className="px-4 py-3 text-right font-mono text-emerald-700">{numberFmt.format(sellerTotals.pay)} {currency}</td></tr></tfoot>
            ) : null}
          </table>
        </div>
      </section>
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

// Tree view: ພະນັກງານ → ໝວດ (category) → ຍີ່ຫໍ້ (brand) → ສິນຄ້າ that earned points.
function BreakdownTree({ data, loading, currency }: { data?: Breakdown; loading: boolean; currency: string }) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  if (loading && !data) return <div className="px-10 py-4 text-sm text-odoo-text-muted">ກຳລັງໂຫລດລາຍລະອຽດ…</div>;
  if (!data) return null;
  if (data.categories.length === 0) return <div className="px-10 py-4 text-sm text-odoo-text-muted">ບໍ່ມີສິນຄ້າທີ່ໄດ້ຄະແນນໃນເດືອນນີ້</div>;
  const toggle = (key: string) =>
    setOpenKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <div className="border-l-2 border-odoo-primary/30 py-2 pl-8 pr-4">
      {data.categories.map((cat) => {
        const catKey = `c:${cat.category}`;
        const catOpen = openKeys.has(catKey);
        return (
          <div key={cat.category} className="border-b border-odoo-border/60 last:border-0">
            <button
              type="button"
              onClick={() => toggle(catKey)}
              className="flex w-full items-center gap-2 py-2 text-left"
            >
              <Chevron open={catOpen} />
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${CAT_CHIP[cat.category] ?? "bg-slate-100 text-slate-700"}`}>
                {cat.label}
              </span>
              <span className="text-xs text-odoo-text-muted">{cat.brands.length} ຍີ່ຫໍ້ · {numberFmt.format(cat.qty)} ໜ່ວຍ</span>
              <span className="ml-auto font-mono text-sm font-bold text-odoo-text-strong">{numberFmt.format(cat.points)} ຄະແນນ</span>
            </button>
            {catOpen ? (
              <div className="pl-6">
                {cat.brands.map((brand) => {
                  const brandKey = `b:${cat.category}:${brand.brand}`;
                  const brandOpen = openKeys.has(brandKey);
                  return (
                    <div key={brand.brand} className="border-t border-odoo-border/40">
                      <button
                        type="button"
                        onClick={() => toggle(brandKey)}
                        className="flex w-full items-center gap-2 py-1.5 text-left"
                      >
                        <Chevron open={brandOpen} />
                        <span className="text-xs font-bold text-odoo-text-strong">{brand.brand}</span>
                        <span className="text-[11px] text-odoo-text-muted">{brand.items.length} ລາຍການ · {numberFmt.format(brand.qty)} ໜ່ວຍ</span>
                        <span className="ml-auto font-mono text-xs font-bold text-odoo-text-strong">{numberFmt.format(brand.points)} ຄະແນນ</span>
                      </button>
                      {brandOpen ? (
                        <div className="overflow-x-auto pb-2">
                          <table className="w-full min-w-[640px] text-xs">
                            <thead>
                              <tr className="text-odoo-text-muted">
                                <th className="px-2 py-1 text-left font-semibold">ວັນທີ</th>
                                <th className="px-2 py-1 text-left font-semibold">ບິນ</th>
                                <th className="px-2 py-1 text-left font-semibold">ສິນຄ້າ</th>
                                <th className="px-2 py-1 text-right font-semibold">ຈຳນວນ</th>
                                <th className="px-2 py-1 text-right font-semibold">ຄະແນນ/ໜ່ວຍ</th>
                                <th className="px-2 py-1 text-right font-semibold">ຄະແນນ</th>
                                <th className="px-2 py-1 text-right font-semibold">ຍອດຂາຍ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-odoo-border/50">
                              {brand.items.map((it, i) => (
                                <tr key={`${it.docNo}-${i}`} className="text-odoo-text-strong">
                                  <td className="whitespace-nowrap px-2 py-1 font-mono">{it.docDate}</td>
                                  <td className="whitespace-nowrap px-2 py-1 font-mono text-odoo-text-muted">{it.docNo}</td>
                                  <td className="px-2 py-1">{it.itemName}</td>
                                  <td className="px-2 py-1 text-right font-mono">{numberFmt.format(it.qty)}</td>
                                  <td className="px-2 py-1 text-right font-mono text-odoo-text-muted">{numberFmt.format(it.unitPoints)}</td>
                                  <td className="px-2 py-1 text-right font-mono font-bold">{numberFmt.format(it.points)}</td>
                                  <td className="px-2 py-1 text-right font-mono">{numberFmt.format(it.salesAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-end gap-2 pt-2 text-sm">
        <span className="text-odoo-text-muted">ລວມຄະແນນ:</span>
        <span className="font-mono font-black text-odoo-primary">{numberFmt.format(data.totalPoints)}</span>
        <span className="text-odoo-text-muted">· × 10 {currency}/ຄະແນນ × ຕົວຄູນ = ໂບນັດ</span>
      </div>
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
        {row.specialReward > 0 ? <Metric label="② ເງິນພິເສດ" value={`${numberFmt.format(row.specialReward)} ${currency}`} /> : null}
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
