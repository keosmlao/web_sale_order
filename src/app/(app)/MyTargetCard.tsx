"use client";

import { useCallback, useEffect, useState } from "react";

type Dashboard = {
  totalSales: number;
  target: number;
  achievementPct: number;
  rank: number;
  teamSize: number;
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
  const remainingAmount = Math.max(0, data.target - data.totalSales);
  const neededPerDay = remainingDays > 0 ? remainingAmount / remainingDays : 0;
  const onTrack = ach >= 1;
  const barColor = onTrack ? "bg-emerald-400" : ach >= 0.8 ? "bg-white" : "bg-amber-300";

  return (
    <section className="odoo-card overflow-hidden bg-gradient-to-br from-odoo-primary to-indigo-800 p-5 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-white/70">ເປົ້າເດືອນນີ້</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-4xl font-black">{(ach * 100).toFixed(0)}%</span>
            <span className="text-sm text-white/80">ບັນລຸເປົ້າ</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {data.rank > 0 ? <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">🏆 ອັນດັບ {data.rank}/{data.teamSize}</span> : null}
          <span className="text-xs text-white/70">ຍັງເຫຼືອ {remainingDays} ວັນ</span>
        </div>
      </div>

      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/20">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, ach * 100)}%` }} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/60">ຍອດຂາຍ</div>
          <div className="font-mono text-sm font-black">{fmt.format(data.totalSales)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/60">ເປົ້າ/ຄົນ</div>
          <div className="font-mono text-sm font-black">{fmt.format(data.target)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/60">ຕ້ອງຂາຍ/ວັນ</div>
          <div className="font-mono text-sm font-black">{onTrack ? "🎉 ບັນລຸ" : remainingDays === 0 ? "—" : fmt.format(Math.round(neededPerDay))}</div>
        </div>
      </div>

      <a href="/reports/my-sales" className="mt-4 block text-center text-xs font-bold text-white/90 hover:underline">
        ເບິ່ງ Dashboard ຍອດຂາຍ &amp; ໂບນັດ →
      </a>
    </section>
  );
}
