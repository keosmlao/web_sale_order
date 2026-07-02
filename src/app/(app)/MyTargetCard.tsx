"use client";

import { useCallback, useEffect, useState } from "react";

type Daily = { date: string; sales: number; qty: number };
export type TargetDashboard = {
  totalSales: number;
  totalQty: number;
  target: number;
  achievementPct: number;
  rank: number;
  teamSize: number;
  daily: Daily[];
  scope?: "employee" | "team";
};

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFRESH_MS = 45000;

export default function MyTargetCard({ initialData = null }: { initialData?: TargetDashboard | null }) {
  const [data, setData] = useState<TargetDashboard | null>(initialData);
  const [loaded, setLoaded] = useState(initialData !== null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/my-sales", { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      setData((await res.json()) as TargetDashboard);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { Promise.resolve().then(() => void load()); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  if (!loaded) return <TargetCardState message="ກຳລັງໂຫລດຍອດຂາຍ ແລະ Target…" pulse />;
  if (error || !data) return <TargetCardState message="ໂຫລດຍອດຂາຍ/Target ບໍ່ສຳເລັດ" />;
  if (data.target <= 0) return <TargetCardState message="ຍັງບໍ່ໄດ້ກຳນົດ Target ສຳລັບເດືອນນີ້" />;

  const ach = data.achievementPct;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.min(now.getDate(), daysInMonth);
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  const neededPerDay = remainingDays > 0 ? Math.max(0, data.target - data.totalSales) / remainingDays : 0;
  const remainingAmount = Math.max(0, data.target - data.totalSales);
  const onTrack = ach >= 1;

  // Pace vs the calendar: by day N of the month you "should" be at N/days of
  // target. ±2pp around that counts as on-plan so the badge doesn't flap.
  const expectedPct = daysInMonth > 0 ? daysElapsed / daysInMonth : 0;
  const paceDiff = ach - expectedPct;
  const pace: "ahead" | "onplan" | "behind" =
    paceDiff >= 0.02 ? "ahead" : paceDiff <= -0.02 ? "behind" : "onplan";
  // End-of-month projection at the current run rate.
  const projectedPct = daysElapsed > 0 ? (ach / daysElapsed) * daysInMonth : 0;

  const pct = Math.min(1, ach);
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.sales));
  // One slot per day of the month so it reads as a trend even early in the month.
  const salesByDay = new Map(data.daily.map((d) => [Number(d.date.slice(8, 10)), d.sales]));
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, sales: salesByDay.get(i + 1) ?? 0 }));

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-[0_10px_35px_-18px_rgba(79,70,229,0.45)]">
      <div className="flex items-center justify-between border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50 to-violet-50/60 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3"/></svg>
          </span>
          <div><div className="text-sm font-black text-slate-900">{data.scope === "team" ? "ເປົ້າຂອງທີມ" : "ເປົ້າຂອງຂ້ອຍ"}</div><div className="text-[10px] font-semibold text-slate-500">ຜົນງານເດືອນນີ້</div></div>
        </div>
        <div className="flex items-center gap-1.5">
          {data.rank > 0 ? <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">🏆 #{data.rank}</span> : null}
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">{remainingDays} ວັນ</span>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-400" />ເປົ້າປະຈຳເດືອນ</div>
            <div className="mt-2 truncate font-mono text-xl font-black tracking-tight text-slate-800 sm:text-2xl">{fmt.format(data.target)}</div>
            <div className="mt-0.5 text-[9px] font-bold text-slate-400">ບາດ · ຕໍ່ຄົນ</div>
          </div>
          <div className="min-w-0 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-600"><span className="h-2 w-2 rounded-full bg-indigo-500" />ຍອດຂາຍແລ້ວ</div>
            <div className="mt-2 truncate font-mono text-xl font-black tracking-tight text-indigo-700 sm:text-2xl">{fmt.format(data.totalSales)}</div>
            <div className="mt-0.5 text-[9px] font-bold text-indigo-400">ບາດ · ເດືອນນີ້</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">ຄວາມຄືບໜ້າ</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`font-mono text-xl font-black ${onTrack ? "text-emerald-600" : "text-indigo-600"}`}>{(ach * 100).toFixed(1)}%</span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[9px] font-black " +
                    (pace === "ahead"
                      ? "bg-emerald-100 text-emerald-700"
                      : pace === "behind"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-amber-100 text-amber-700")
                  }
                  title={`ວັນທີ ${daysElapsed}/${daysInMonth} ຄວນຢູ່ ~${(expectedPct * 100).toFixed(0)}%`}
                >
                  {pace === "ahead"
                    ? `ໄວກວ່າແຜນ +${Math.abs(paceDiff * 100).toFixed(0)}%`
                    : pace === "behind"
                      ? `ຊ້າກວ່າແຜນ −${Math.abs(paceDiff * 100).toFixed(0)}%`
                      : "ຕາມແຜນ"}
                </span>
              </div>
            </div>
            <div className="text-right"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{onTrack ? "ເກີນເປົ້າ" : "ຍັງຂາດ"}</div><div className={`mt-0.5 font-mono text-base font-black ${onTrack ? "text-emerald-600" : "text-amber-600"}`}>{fmt.format(onTrack ? data.totalSales - data.target : remainingAmount)} ບາດ</div></div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70">
            <div className={`h-full rounded-full transition-all duration-700 ${onTrack ? "bg-gradient-to-r from-emerald-400 to-emerald-600" : "bg-gradient-to-r from-indigo-500 to-violet-500"}`} style={{ width: `${Math.max(2, pct * 100)}%` }} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-slate-200 ring-1 ring-slate-200">
          <Metric label="ວັນຄົງເຫຼືອ" value={`${remainingDays} ວັນ`} />
          <Metric label="ຕ້ອງຂາຍ/ວັນ" value={onTrack ? "ບັນລຸແລ້ວ 🎉" : remainingDays === 0 ? "—" : fmt.format(Math.round(neededPerDay))} />
          <Metric
            label="ຄາດການສິ້ນເດືອນ"
            value={daysElapsed > 0 ? `~${(projectedPct * 100).toFixed(0)}%` : "—"}
            tone={projectedPct >= 1 ? "good" : projectedPct >= 0.8 ? "warn" : "bad"}
          />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-slate-400"><span>ຍອດຂາຍລາຍວັນ</span><span>01–{daysInMonth}</span></div>
          <div className="flex h-10 items-end gap-px rounded-lg bg-slate-50 px-1.5 pt-1.5 ring-1 ring-inset ring-slate-100">
          {monthDays.map((d) => (
            <div
              key={d.day}
              className={`flex-1 rounded-t-sm ${d.day === daysElapsed ? "bg-amber-400" : "bg-indigo-300"}`}
              style={{ height: d.sales > 0 ? `${Math.max(8, (d.sales / maxDaily) * 100)}%` : "2px" }}
              title={`ວັນທີ ${d.day}: ${fmt.format(d.sales)}`}
            />
          ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TargetCardState({ message, pulse = false }: { message: string; pulse?: boolean }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-[0_10px_35px_-18px_rgba(79,70,229,0.45)]">
      <div className="flex items-center gap-2.5 border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50 to-violet-50/60 px-4 py-3.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>
        </span>
        <div><div className="text-sm font-black text-slate-900">ຍອດຂາຍ vs ເປົ້າ</div><div className="text-[10px] font-semibold text-slate-500">ຜົນງານເດືອນນີ້</div></div>
      </div>
      <div className={`flex min-h-28 items-center justify-center px-4 py-6 text-center text-sm font-bold text-slate-500 ${pulse ? "animate-pulse" : ""}`}>{message}</div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const valueColor =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-rose-600" : "text-slate-800";
  return (
    <div className="min-w-0 bg-slate-50 px-2 py-3 text-center sm:px-3">
      <div className="truncate text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-black leading-tight sm:text-base ${valueColor}`}>{value}</div>
    </div>
  );
}
