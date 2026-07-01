"use client";

import { useCallback, useEffect, useState } from "react";

type Daily = { date: string; sales: number; qty: number };
type Category = { name: string; sales: number; qty: number };
type Dashboard = {
  year: number;
  month: number;
  displayName: string;
  employeeCode: string;
  totalSales: number;
  totalQty: number;
  target: number;
  achievementPct: number;
  rank: number;
  teamSize: number;
  daily: Daily[];
  categories: Category[];
};

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFRESH_MS = 45000;

function currentPeriod(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vientiane", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")?.value ?? "2026"}-${parts.find((p) => p.type === "month")?.value ?? "01"}`;
}

export default function MySalesClient() {
  const [period, setPeriod] = useState(currentPeriod);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    const [year, month] = period.split("-");
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/my-sales?year=${year}&month=${month}`, { cache: "no-store" });
      const body = (await res.json()) as Dashboard & { error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setData(body);
      setUpdatedAt(new Date().toLocaleTimeString("en-GB"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period]);

  useEffect(() => { Promise.resolve().then(() => void load()); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(true), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const ach = data?.achievementPct ?? 0;
  const achColor = ach >= 1 ? "text-emerald-700" : ach >= 0.8 ? "text-odoo-primary" : "text-amber-700";
  const maxDaily = Math.max(1, ...(data?.daily ?? []).map((d) => d.sales));
  const maxCat = Math.max(1, ...(data?.categories ?? []).map((c) => c.sales));

  // Pace / projection for the selected month (only meaningful for the current month).
  const [pYear, pMonth] = period.split("-").map(Number);
  const daysInMonth = new Date(pYear, pMonth, 0).getDate();
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === pYear && now.getMonth() + 1 === pMonth;
  const daysElapsed = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  const totalSales = data?.totalSales ?? 0;
  const target = data?.target ?? 0;
  const projected = daysElapsed > 0 ? (totalSales / daysElapsed) * daysInMonth : totalSales;
  const neededPerDay = remainingDays > 0 ? Math.max(0, target - totalSales) / remainingDays : 0;
  const onTrack = target > 0 && projected >= target;

  return (
    <div className="odoo-page">
      <div className="odoo-page-header">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">Dashboard</div>
          <h1 className="odoo-page-title">ຍອດຂາຍຂອງຂ້ອຍ</h1>
          <p className="odoo-page-subtitle flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{data?.displayName ?? "—"} · ໜ້າຮ້ານ (walk-in)</span>
            {data && data.rank > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">🏆 ອັນດັບ {data.rank}/{data.teamSize}</span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE
            </span>
            {updatedAt ? <span className="text-[11px] text-odoo-text-muted">ອັບເດດ {updatedAt}</span> : null}
          </p>
        </div>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="odoo-input w-40" />
      </div>

      {error ? <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-odoo-danger">{error}</div> : null}
      {loading && !data ? <div className="odoo-card p-10 text-center text-sm text-odoo-text-muted">ກຳລັງໂຫລດ…</div> : null}

      {data ? (
        <>
          {/* KPI row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="ຍອດຂາຍເດືອນນີ້" value={`${fmt.format(data.totalSales)}`} accent />
            <Kpi label="ເປົ້າ/ຄົນ" value={fmt.format(data.target)} />
            <Kpi label="% ບັນລຸເປົ້າ" value={`${(ach * 100).toFixed(1)}%`} valueClass={achColor} />
            <Kpi label="ຈຳນວນຂາຍ (ໜ່ວຍ)" value={fmt.format(data.totalQty)} />
          </div>

          {/* Target progress */}
          <div className="odoo-card mt-4 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-bold text-odoo-text-strong">ຄວາມຄືບໜ້າຕໍ່ເປົ້າ</span>
              <span className="font-mono text-odoo-text-muted">{fmt.format(data.totalSales)} / {fmt.format(data.target)}</span>
            </div>
            <div className="h-4 w-full overflow-hidden rounded-full bg-odoo-surface-muted">
              <div className={`h-full rounded-full ${ach >= 1 ? "bg-emerald-500" : ach >= 0.8 ? "bg-odoo-primary" : "bg-amber-500"}`} style={{ width: `${Math.min(100, ach * 100)}%` }} />
            </div>
            <div className="mt-2 flex justify-end text-xs text-odoo-text-muted">
              <span>{(ach * 100).toFixed(1)}%</span>
            </div>
          </div>

          {isCurrentMonth ? (
            <div className="odoo-card mt-4 grid gap-4 p-4 sm:grid-cols-3">
              <PaceItem label="ຄາດຄະເນ ສິ້ນເດືອນ" value={fmt.format(Math.round(projected))} sub={target > 0 ? `${((projected / target) * 100).toFixed(0)}% ຂອງເປົ້າ` : "—"} tone={onTrack ? "good" : "warn"} />
              <PaceItem label="ຜ່ານໄປ" value={`${daysElapsed}/${daysInMonth} ວັນ`} sub={`ຍັງເຫຼືອ ${remainingDays} ວັນ`} />
              <PaceItem label="ຕ້ອງຂາຍອີກ/ວັນ" value={onTrack || remainingDays === 0 ? "—" : fmt.format(Math.round(neededPerDay))} sub={onTrack ? "ຢູ່ໃນເປົ້າ 👍" : "ເພື່ອບັນລຸເປົ້າ"} tone={onTrack ? "good" : "warn"} />
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* Daily sales bars */}
            <div className="odoo-card p-4">
              <h2 className="mb-3 text-sm font-black text-odoo-text-strong">ຍອດຂາຍລາຍວັນ</h2>
              {data.daily.length === 0 ? <p className="py-8 text-center text-sm text-odoo-text-muted">ຍັງບໍ່ມີຍອດຂາຍ</p> : (
                <div className="flex h-40 items-end gap-1 overflow-x-auto">
                  {data.daily.map((d) => (
                    <div key={d.date} className="group flex min-w-[14px] flex-1 flex-col items-center justify-end" title={`${d.date}: ${fmt.format(d.sales)}`}>
                      <div className="w-full rounded-t bg-odoo-primary transition-all group-hover:bg-emerald-600" style={{ height: `${(d.sales / maxDaily) * 100}%` }} />
                      <span className="mt-1 text-[9px] text-odoo-text-muted">{d.date.slice(8)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Category breakdown */}
            <div className="odoo-card p-4">
              <h2 className="mb-3 text-sm font-black text-odoo-text-strong">ຍອດຂາຍຕາມໝວດ</h2>
              {data.categories.length === 0 ? <p className="py-8 text-center text-sm text-odoo-text-muted">ຍັງບໍ່ມີຍອດຂາຍ</p> : (
                <div className="space-y-2">
                  {data.categories.map((c) => (
                    <div key={c.name}>
                      <div className="mb-0.5 flex justify-between text-xs">
                        <span className="truncate pr-2 text-odoo-text-strong">{c.name}</span>
                        <span className="font-mono text-odoo-text-muted">{fmt.format(c.sales)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-odoo-surface-muted">
                        <div className="h-full rounded-full bg-odoo-primary" style={{ width: `${(c.sales / maxCat) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-odoo-text-muted">
            <a href="/reports/incentives" className="font-bold text-odoo-primary hover:underline">ເບິ່ງໂບນັດ &amp; ຄ່າຄອມຂອງຂ້ອຍ →</a>
          </p>
        </>
      ) : null}
    </div>
  );
}

function PaceItem({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-odoo-text-strong";
  return (
    <div className="text-center">
      <div className="text-xs font-bold uppercase tracking-wide text-odoo-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-xl font-black ${color}`}>{value}</div>
      <div className="text-[11px] text-odoo-text-muted">{sub}</div>
    </div>
  );
}

function Kpi({ label, value, accent = false, valueClass }: { label: string; value: string; accent?: boolean; valueClass?: string }) {
  return (
    <div className={`odoo-card p-4 ${accent ? "bg-gradient-to-br from-odoo-primary to-odoo-primary-700 text-white" : ""}`}>
      <div className={`text-xs font-bold uppercase tracking-wide ${accent ? "text-white/80" : "text-odoo-text-muted"}`}>{label}</div>
      <div className={`mt-1 font-mono text-2xl font-black ${valueClass ?? (accent ? "text-white" : "text-odoo-text-strong")}`}>{value}</div>
    </div>
  );
}
