"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type IncentiveRow = {
  employeeCode: string;
  displayName: string;
  groupCode: string;
  soldQty: number;
  salesAmount: number;
  targetPerPerson: number;
  achievementPct: number;
  normalBonus: number;
  multiplier: number;
  netBonus: number;
  specialReward: number;
  commissionRate: number;
  commission: number;
  totalPay: number;
};

type Tiers = {
  lowMaxPct: number;
  standardMaxPct: number;
  lowMultiplier: number;
  standardMultiplier: number;
  highMultiplier: number;
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
  const currency = report?.currencyCode ?? "THB";
  const tiers = report?.tiers;
  const hasSpecial = (report?.totalSpecial ?? 0) > 0;
  const isSelf = report?.scope === "self";

  return (
    <div className="odoo-page">
      <div className="odoo-page-header">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">Reports</div>
          <h1 className="odoo-page-title">{isSelf ? "ໂບນັດຂອງຂ້ອຍ" : "ໂບນັດພະນັກງານຂາຍ"}</h1>
          <p className="odoo-page-subtitle flex flex-wrap items-center gap-x-2">
            <span>ຄຳນວນຈາກໃບຮັບເງິນຈິງ · ສະກຸນ {currency}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
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

      <section className="odoo-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid w-full gap-1 sm:w-auto">
            <span className="odoo-label">ເດືອນ</span>
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="odoo-input" />
          </label>
          <button type="button" onClick={() => void load()} className="odoo-btn odoo-btn-primary">ໂຫລດໃໝ່</button>
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
                <th className="px-3 py-3 text-right">ໂບນັດປົກກະຕິ</th>
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
              ) : rows.length === 0 ? (
                <tr><td colSpan={hasSpecial ? 13 : 12} className="px-4 py-12 text-center text-odoo-text-muted">ບໍ່ມີຍອດຂາຍໃນເດືອນນີ້</td></tr>
              ) : rows.map((row, index) => (
                <tr key={`${row.employeeCode}-${row.groupCode}`}>
                  <td className="px-3 py-3 text-center font-mono text-odoo-text-muted">{index + 1}</td>
                  <td className="px-4 py-3"><div className="font-bold text-odoo-text-strong">{row.displayName}</div><div className="font-mono text-[10px] text-odoo-text-muted">{row.employeeCode}</div></td>
                  <td className="px-3 py-3"><span className="rounded-full bg-odoo-primary-100 px-2 py-1 text-[11px] font-bold text-odoo-primary">{row.groupCode === "AIR" ? "AIR" : "CE + SDA"}</span></td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.soldQty)}</td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.salesAmount)}</td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.targetPerPerson)}</td>
                  <td className="px-3 py-3 text-right"><Achievement value={row.achievementPct} tiers={tiers} /></td>
                  <td className="px-3 py-3 text-right font-mono">{numberFmt.format(row.normalBonus)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold">×{row.multiplier.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-odoo-text-strong">{numberFmt.format(row.netBonus)}</td>
                  {hasSpecial ? <td className="px-3 py-3 text-right font-mono">{row.specialReward > 0 ? numberFmt.format(row.specialReward) : "—"}</td> : null}
                  <td className="px-3 py-3 text-right font-mono">{row.commission > 0 ? numberFmt.format(row.commission) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-black text-emerald-700">{numberFmt.format(row.totalPay)} {currency}</td>
                </tr>
              ))}
            </tbody>
            {!loading && rows.length > 0 ? (
              <tfoot><tr className="border-t-2 border-odoo-border bg-odoo-surface-muted font-bold"><td colSpan={4} className="px-4 py-3">ລວມ</td><td className="px-3 py-3 text-right font-mono">{numberFmt.format(report?.totalSales ?? 0)}</td><td colSpan={4} /><td className="px-3 py-3 text-right font-mono text-odoo-text-strong">{numberFmt.format(report?.totalBonus ?? 0)}</td>{hasSpecial ? <td className="px-3 py-3 text-right font-mono">{numberFmt.format(report?.totalSpecial ?? 0)}</td> : null}<td className="px-3 py-3 text-right font-mono">{numberFmt.format(report?.totalCommission ?? 0)}</td><td className="px-4 py-3 text-right font-mono text-emerald-700">{numberFmt.format(report?.totalPay ?? 0)} {currency}</td></tr></tfoot>
            ) : null}
          </table>
        </div>
      </section>
      )}
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
        <Metric label="ຜົນງານ" value={`${(row.achievementPct * 100).toFixed(1)}%`} valueClass={achColor} />
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
  return <span className={`font-mono font-bold ${color}`}>{(value * 100).toFixed(1)}%</span>;
}
