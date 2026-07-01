"use client";

import { useCallback, useEffect, useState } from "react";

type Daily = { date: string; sales: number; qty: number };
type Dashboard = {
  totalSales: number;
  totalQty: number;
  target: number;
  achievementPct: number;
  rank: number;
  teamSize: number;
  daily: Daily[];
};

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFRESH_MS = 45000;

export default function MyTargetCard() {
  const [data, setData] = useState<Dashboard | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/my-sales", { cache: "no-store" });
      if (!res.ok) return;
      setData((await res.json()) as Dashboard);
    } catch {
      /* silent — this card is optional */
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  // Only relevant for salespeople who have a monthly target.
  if (!data || data.target <= 0) return null;

  const ach = data.achievementPct;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.min(now.getDate(), daysInMonth);
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  const neededPerDay = remainingDays > 0 ? Math.max(0, data.target - data.totalSales) / remainingDays : 0;
  const onTrack = ach >= 1;

  // Donut geometry.
  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = Math.min(1, ach);
  const ringColor = onTrack ? "#34d399" : ach >= 0.8 ? "#ffffff" : "#fbbf24";
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.sales));

  return (
    <>
    <section className="odoo-card overflow-hidden bg-gradient-to-br from-odoo-primary to-indigo-800 p-5 text-white">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-widest text-white/70">ເປົ້າເດືອນນີ້</div>
        <div className="flex items-center gap-2">
          {data.rank > 0 ? <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">🏆 {data.rank}/{data.teamSize}</span> : null}
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">ຍັງເຫຼືອ {remainingDays} ວັນ</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        {/* Donut / pie chart */}
        <div className="relative shrink-0">
          <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="13" />
            <circle
              cx="60" cy="60" r={R} fill="none" stroke={ringColor} strokeWidth="13" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - pct)} className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl font-black">{(ach * 100).toFixed(0)}%</span>
            <span className="text-[10px] uppercase tracking-wide text-white/70">ບັນລຸເປົ້າ</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid w-full grid-cols-2 gap-x-4 gap-y-3">
          <Metric label="ຍອດຂາຍ" value={fmt.format(data.totalSales)} />
          <Metric label="ເປົ້າ/ຄົນ" value={fmt.format(data.target)} />
          <Metric label="ຕ້ອງຂາຍ/ວັນ" value={onTrack ? "🎉 ບັນລຸ" : remainingDays === 0 ? "—" : fmt.format(Math.round(neededPerDay))} />
          <Metric label="ຈຳນວນຂາຍ" value={fmt.format(data.totalQty)} />
        </div>
      </div>

      {/* Daily mini-trend */}
      {data.daily.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/60">ຍອດຂາຍລາຍວັນ</div>
          <div className="flex h-12 items-end gap-0.5">
            {data.daily.map((d) => (
              <div key={d.date} className="flex-1 rounded-t bg-white/70" style={{ height: `${Math.max(4, (d.sales / maxDaily) * 100)}%` }} title={`${d.date}: ${fmt.format(d.sales)}`} />
            ))}
          </div>
        </div>
      ) : null}

    </section>

      <a href="/reports/incentives" className="odoo-card mt-3 flex items-center justify-between p-4 font-black text-odoo-text-strong transition hover:bg-odoo-surface-muted">
        <span>💰 ເບິ່ງໂບນັດ &amp; ຄ່າຄອມຂອງຂ້ອຍ</span>
        <span className="text-lg text-odoo-text-muted">›</span>
      </a>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-white/60">{label}</div>
      <div className="font-mono text-lg font-black">{value}</div>
    </div>
  );
}
