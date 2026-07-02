"use client";

import { useCallback, useEffect, useState } from "react";

type CommissionLine = {
  groupCode: string;
  base: number;
  achievementPct: number;
  rate: number;
  amount: number;
};

type Row = {
  bonusPoints: number;
  netBonus: number;
  specialReward: number;
  commission: number;
  commissionRate: number;
  totalPay: number;
  multiplier: number;
  achievementPct: number;
  targetPerPerson: number;
  commissionLines?: CommissionLine[] | null;
};

const GROUP_LABEL: Record<string, string> = {
  CE_SDA: "CE+SDA",
  AIR: "AIR",
  ALL: "ລວມທັງໝົດ",
};

type Tiers = {
  lowMaxPct: number;
  standardMaxPct: number;
  lowMultiplier: number;
  standardMultiplier: number;
  highMultiplier: number;
};

const pointFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
type Report = { currencyCode: string; rows: Row[]; tiers?: Tiers; commissionBase?: number };
type Item = { itemName: string; brand: string; category: string; qty: number; points: number };
type DailyPoint = { day: string; points: number };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFRESH_MS = 45000;

export default function MyBonusCard() {
  const [row, setRow] = useState<Row | null>(null);
  const [tiers, setTiers] = useState<Tiers | null>(null);
  const [currency, setCurrency] = useState("THB");
  const [commissionBase, setCommissionBase] = useState(0);
  const [open, setOpen] = useState(false);
  // ສະສົມ (whole month) / ມື້ນີ້ (today only) tabs — each list fetched lazily
  // the first time its tab is shown.
  const [itemsTab, setItemsTab] = useState<"month" | "today">("month");
  const [itemsMonth, setItemsMonth] = useState<Item[] | null>(null);
  const [itemsToday, setItemsToday] = useState<Item[] | null>(null);

  const loadItems = useCallback(async (scope: "month" | "today") => {
    try {
      const res = await fetch(
        scope === "today" ? "/api/reports/my-bonus-items?scope=today" : "/api/reports/my-bonus-items",
        { cache: "no-store" },
      );
      const list = res.ok ? ((await res.json()) as { items: Item[] }).items : [];
      if (scope === "today") setItemsToday(list);
      else setItemsMonth(list);
    } catch {
      if (scope === "today") setItemsToday([]);
      else setItemsMonth([]);
    }
  }, []);

  const toggleItems = useCallback(async () => {
    setOpen((v) => !v);
    if (itemsTab === "month" ? itemsMonth === null : itemsToday === null) {
      await loadItems(itemsTab);
    }
  }, [itemsTab, itemsMonth, itemsToday, loadItems]);

  const switchItemsTab = useCallback(
    (tab: "month" | "today") => {
      setItemsTab(tab);
      if (tab === "month" ? itemsMonth === null : itemsToday === null) {
        void loadItems(tab);
      }
    },
    [itemsMonth, itemsToday, loadItems],
  );

  const items = itemsTab === "month" ? itemsMonth : itemsToday;
  const [daily, setDaily] = useState<DailyPoint[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/incentives?self=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Report;
      setCurrency(data.currencyCode || "THB");
      setRow(data.rows?.[0] ?? null);
      setTiers(data.tiers ?? null);
      setCommissionBase(data.commissionBase ?? 0);
      try {
        const dRes = await fetch("/api/reports/my-bonus-daily", { cache: "no-store" });
        if (dRes.ok) setDaily(((await dRes.json()) as { daily: DailyPoint[] }).daily ?? []);
      } catch {
        /* daily chart is optional */
      }
    } catch {
      /* silent — optional card */
    }
  }, []);

  useEffect(() => { Promise.resolve().then(() => void load()); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  if (!row) return null;
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const todayPoints = daily.find((entry) => entry.day === todayIso)?.points ?? 0;
  const bonusTotal = row.netBonus + row.specialReward;
  // Manager / unit head: commission-only (per-group team lines) — every
  // bonus-points section is hidden for them.
  const isRoleComm = !!(row.commissionLines && row.commissionLines.length > 0);
  // Show the Lao word for baht instead of the ISO code.
  const currencyLabel = currency === "THB" ? "ບາດ" : currency;

  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_10px_35px_-18px_rgba(5,150,105,0.4)] sm:mt-3">
      <div className="flex items-center justify-between border-b border-emerald-100/70 bg-gradient-to-r from-emerald-50 to-teal-50/60 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/></svg>
          </span>
          <div><div className="text-sm font-black text-slate-900">{isRoleComm ? "ຄ່າຄອມ" : "ໂບນັດ ແລະ ຄ່າຄອມ"}</div><div className="text-[10px] font-semibold text-slate-500">ລາຍຮັບເພີ່ມເດືອນນີ້</div></div>
        </div>
      </div>

      <div className="p-4">
        {/* HEADLINE: the total to receive, styled like a banknote — ornate
            frame, denomination in the corners, guilloche rings, serial no. */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-800 via-emerald-900 to-teal-950 p-1.5 shadow-md">
          {/* guilloche-style rings */}
          <div className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full border-[10px] border-emerald-100/[0.06]" />
          <div className="pointer-events-none absolute -left-4 -top-4 h-24 w-24 rounded-full border-[6px] border-emerald-100/[0.05]" />
          <div className="pointer-events-none absolute -bottom-12 -right-12 h-44 w-44 rounded-full border-[12px] border-emerald-100/[0.06]" />
          <div className="pointer-events-none absolute -bottom-5 -right-5 h-28 w-28 rounded-full border-[7px] border-emerald-100/[0.05]" />
          {/* inner banknote frame */}
          <div className="relative rounded-lg border border-dashed border-emerald-200/40 px-3 pb-3 pt-2.5">
            {/* denomination in the four corners */}
            <span className="absolute left-2 top-1.5 font-mono text-[10px] font-black text-emerald-200/70">{fmt.format(row.totalPay)}</span>
            <span className="absolute right-2 top-1.5 font-mono text-[10px] font-black text-emerald-200/70">{fmt.format(row.totalPay)}</span>
            <span className="absolute bottom-1.5 left-2 font-mono text-[10px] font-black text-emerald-200/70">{fmt.format(row.totalPay)}</span>
            <span className="absolute bottom-1.5 right-2 font-mono text-[10px] font-black text-emerald-200/70">{fmt.format(row.totalPay)}</span>
            <div className="text-center text-white">
              <div className="text-[8px] font-bold tracking-[0.35em] text-emerald-300/90">
                ✦ ODIEN GROUP ✦
              </div>
              <div className="mt-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-200">
                ລວມທີ່ຕ້ອງຮັບ
              </div>
              <div className="mt-0.5 flex items-baseline justify-center gap-1.5">
                <span className="font-mono text-5xl font-black tracking-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
                  {fmt.format(row.totalPay)}
                </span>
                <span className="text-xs font-black text-emerald-200/90">{currencyLabel}</span>
              </div>
              <div className="mt-1 text-[10px] font-bold text-emerald-100/80">
                {isRoleComm
                  ? `ຄ່າຄອມຕາມຜົນງານທີມ`
                  : `ໂບນັດ ${fmt.format(bonusTotal)} + ຄ່າຄອມ ${fmt.format(row.commission)}`}
              </div>
              <div className="mt-1 font-mono text-[8px] font-bold tracking-[0.25em] text-emerald-300/60">
                Nº {todayIso.slice(5, 7)}/{todayIso.slice(0, 4)}
              </div>
            </div>
          </div>
        </div>

        {isRoleComm ? null : (
        <div className="mt-3 grid grid-cols-2 divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-center gap-2 px-2 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-[9px] font-black text-slate-500">ສະສົມ</span>
            <span className="font-mono text-base font-black text-emerald-700">{pointFmt.format(row.bonusPoints)}</span>
          </div>
          <div className="flex items-center justify-center gap-2 px-2 py-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            <span className="text-[9px] font-black text-slate-500">ມື້ນີ້</span>
            <span className="font-mono text-base font-black text-indigo-700">+{pointFmt.format(todayPoints)}</span>
          </div>
        </div>
        )}

        {/* Bonus and commission as two clearly separate cards, then the
            combined total — so it's obvious what comes from points earned
            (ໂບນັດ) versus from hitting the sales target (ຄ່າຄອມ). */}
        <div className={`mt-3 grid gap-2 ${isRoleComm ? "grid-cols-1" : "grid-cols-2"}`}>
          {isRoleComm ? null : (
          <div className="rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 px-2.5 py-2 text-white shadow-sm">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-black text-emerald-100">ໂບນັດ</span>
              <span className="text-[8px] font-semibold text-emerald-100/90">
                {pointFmt.format(row.bonusPoints)} ຄະແນນ × {pointFmt.format(row.multiplier)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-base font-black leading-none">{fmt.format(bonusTotal)}</span>
              <span className="text-[8px] font-black text-emerald-100">{currencyLabel}</span>
            </div>
            {row.specialReward > 0 ? (
              <div className="mt-0.5 text-[8px] font-semibold text-emerald-100/90">
                +ພິເສດ {fmt.format(row.specialReward)}
              </div>
            ) : null}
          </div>
          )}
          <div className="rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 px-2.5 py-2 text-white shadow-sm">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[9px] font-black text-indigo-100">ຄ່າຄອມ</span>
              <span className="text-[8px] font-semibold text-indigo-100/90">
                {isRoleComm ? "ຕາມຜົນງານທີມ" : `ບັນລຸ ${pctFmt.format(row.achievementPct * 100)}%`}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="font-mono text-base font-black leading-none">{fmt.format(row.commission)}</span>
              <span className="text-[8px] font-black text-indigo-100">{currencyLabel}</span>
            </div>
          </div>
        </div>
        {/* How the commission is worked out — the caller's OWN numbers first
            (base × rate = amount), then the 3 tier rules with concrete
            examples so "rounded up/down to 5%" is obvious. Managers / unit
            heads get a per-product-group breakdown driven by the TEAM's
            achievement instead of the single personal formula. */}
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
          <div className="text-[11px] font-black text-slate-700">ວິທີຄິດຄ່າຄອມ</div>
          {row.commissionLines && row.commissionLines.length > 0 ? (
            <div className="mt-2 space-y-1">
              {row.commissionLines.map((l) => (
                <div key={l.groupCode} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] font-bold ring-1 ring-inset ring-indigo-100">
                  <span className="text-slate-500">
                    {GROUP_LABEL[l.groupCode] ?? l.groupCode}
                    <span className="ml-1 text-[9px] text-slate-400">ທີມບັນລຸ {pctFmt.format(l.achievementPct * 100)}%</span>
                  </span>
                  <span>
                    <span className="text-slate-800">{fmt.format(l.base)}</span>
                    <span className="text-slate-400"> × </span>
                    <span className="text-indigo-600">{pctFmt.format(l.rate * 100)}%</span>
                    <span className="text-slate-400"> = </span>
                    <span className="text-emerald-700">{fmt.format(l.amount)}</span>
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] font-black text-white">
                <span>ລວມຄ່າຄອມ</span>
                <span>{fmt.format(row.commission)} {currencyLabel}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-lg bg-white px-2 py-2.5 text-center font-mono text-[13px] font-black ring-1 ring-inset ring-indigo-100">
                <span className="text-slate-400">ຖານ</span>
                <span className="text-slate-800">{fmt.format(commissionBase)}</span>
                <span className="text-slate-400">×</span>
                <span className="text-indigo-600">{pctFmt.format(row.commissionRate * 100)}%</span>
                <span className="text-slate-400">=</span>
                <span className="text-emerald-700">{fmt.format(row.commission)}</span>
                <span className="text-[9px] font-bold text-slate-400">{currencyLabel}</span>
              </div>
              <div className="mt-1.5 text-center text-[10px] font-bold text-slate-500">
                ເລກ {pctFmt.format(row.commissionRate * 100)}% ມາຈາກ ຍอดขาย{" "}
                <b className="text-indigo-700">{pctFmt.format(row.achievementPct * 100)}%</b> ຂອງເປົ້າ
              </div>
            </>
          )}
          <div className="mt-2.5 divide-y divide-indigo-100 overflow-hidden rounded-lg border border-indigo-100 bg-white/70 text-[10px]">
            <CommissionCondition range="ຕ່ຳກວ່າ 80%" description="ບໍ່ໄດ້ຄ່າຄອມ" tone="muted" />
            <CommissionCondition range="80–99%" description="ປັດ​ລົງ​ຫາ 5% ໃກ້ຄຽງ (ເຊັ່ນ 87% ໄດ້ເລກ 85%)" tone="indigo" />
            <CommissionCondition range="100% ຂຶ້ນໄປ" description="ປັດ​ຂຶ້ນ​ຫາ 5% ໃກ້ຄຽງ (ເຊັ່ນ 103% ໄດ້ເລກ 105%)" tone="emerald" />
          </div>
        </div>

        {row.targetPerPerson > 0 && tiers ? (() => {
          // Progress bar scaled 0 → 120% of target so the ×1.1 zone (over 100%)
          // is visible. Tier ticks sit at low_max_pct (50%) and standard_max_pct
          // (100%); the fill = current achievement, coloured by the active tier.
          const maxScale = (tiers.standardMaxPct || 1) * 1.2;
          const clamp = (v: number) => Math.max(0, Math.min(100, v));
          const fillPct = clamp((row.achievementPct / maxScale) * 100);
          const lowPos = clamp((tiers.lowMaxPct / maxScale) * 100);
          const stdPos = clamp((tiers.standardMaxPct / maxScale) * 100);
          const inStd = row.achievementPct > tiers.lowMaxPct && row.achievementPct <= tiers.standardMaxPct;
          const inHigh = row.achievementPct > tiers.standardMaxPct;
          const fillColor = inHigh ? "bg-emerald-500" : inStd ? "bg-indigo-500" : "bg-amber-400";
          return (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
              <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-500">
                <span>ຂັ້ນຕົວຄູນໂບນັດ</span>
                <span>ຕອນນີ້ <b className="text-emerald-700">×{pointFmt.format(row.multiplier)}</b> · ບັນລຸ <b className="text-indigo-700">{pctFmt.format(row.achievementPct * 100)}%</b></span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-200">
                <div className={`absolute inset-y-0 left-0 rounded-full ${fillColor} transition-all duration-700`} style={{ width: `${fillPct}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-slate-400/80" style={{ left: `${lowPos}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-slate-500/80" style={{ left: `${stdPos}%` }} />
              </div>
              {/* Threshold %s under the tier ticks */}
              <div className="relative mt-1 h-3 text-[9px] font-bold text-slate-400">
                <span className="absolute -translate-x-1/2" style={{ left: `${lowPos}%` }}>{pctFmt.format(tiers.lowMaxPct * 100)}%</span>
                <span className="absolute -translate-x-1/2" style={{ left: `${stdPos}%` }}>{pctFmt.format(tiers.standardMaxPct * 100)}%</span>
              </div>
              {/* Multiplier per zone (active one highlighted) */}
              <div className="mt-1 flex justify-between text-[10px] font-black">
                <span className={!inStd && !inHigh ? "text-amber-600" : "text-slate-300"}>×{pointFmt.format(tiers.lowMultiplier)}</span>
                <span className={inStd ? "text-indigo-600" : "text-slate-300"}>×{pointFmt.format(tiers.standardMultiplier)}</span>
                <span className={inHigh ? "text-emerald-600" : "text-slate-300"}>×{pointFmt.format(tiers.highMultiplier)}</span>
              </div>
              {/* Actionable gaps: exactly how much more to sell to reach the
                  next multiplier tier and the next commission step. */}
              {(() => {
                const target = row.targetPerPerson;
                const sales = row.achievementPct * target;
                const gaps: { amount: number; label: string }[] = [];
                if (row.achievementPct <= tiers.lowMaxPct) {
                  gaps.push({
                    amount: tiers.lowMaxPct * target - sales,
                    label: `ຕົວຄູນ ×${pointFmt.format(tiers.standardMultiplier)}`,
                  });
                } else if (row.achievementPct <= tiers.standardMaxPct) {
                  gaps.push({
                    amount: tiers.standardMaxPct * target - sales,
                    label: `ຕົວຄູນ ×${pointFmt.format(tiers.highMultiplier)}`,
                  });
                }
                if (row.achievementPct < 0.8) {
                  gaps.push({
                    amount: 0.8 * target - sales,
                    label: "ເລີ່ມໄດ້ຄ່າຄອມ (80%)",
                  });
                } else {
                  const nextStep = (Math.floor(row.achievementPct * 20) + 1) / 20;
                  gaps.push({
                    amount: nextStep * target - sales,
                    label: `ຄ່າຄອມຂຶ້ນເປັນ ${pctFmt.format(nextStep * 100)}%`,
                  });
                }
                if (gaps.length === 0) return null;
                return (
                  <div className="mt-2 space-y-1">
                    {gaps.map((g) => (
                      <div key={g.label} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-bold ring-1 ring-inset ring-slate-100">
                        <span className="text-slate-500">
                          ຂາຍອີກ <b className="font-mono text-slate-800">{fmt.format(Math.max(0, Math.ceil(g.amount)))}</b>
                        </span>
                        <span className="text-emerald-700">→ {g.label}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })() : null}

        {daily.length > 0 && !isRoleComm ? (() => {
          const now = new Date();
          const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const todayDom = now.getDate();
          const byDom = new Map(daily.map((d) => [Number(d.day.slice(8, 10)), d.points]));
          const monthDays = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, points: byDom.get(i + 1) ?? 0 }));
          const maxDaily = Math.max(1, ...monthDays.map((d) => d.points));
          return (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-slate-400">
                <span>ຄະແນນທີ່ໄດ້ລາຍວັນ</span>
                <span>ເດືອນນີ້</span>
              </div>
              <div className="flex h-12 items-end gap-px rounded-lg bg-slate-50 p-1.5 ring-1 ring-inset ring-slate-100">
                {monthDays.map((d) => (
                  <div
                    key={d.day}
                    className={`flex-1 rounded-sm ${d.day === todayDom ? "bg-emerald-500" : d.points > 0 ? "bg-emerald-300" : "bg-slate-200"}`}
                    style={{ height: d.points > 0 ? `${Math.max(10, (d.points / maxDaily) * 100)}%` : "3px" }}
                    title={`ວັນທີ ${d.day}: ${pointFmt.format(d.points)} ຄະແນນ`}
                  />
                ))}
              </div>
            </div>
          );
        })() : null}

        {isRoleComm ? null : (
        <button type="button" onClick={() => void toggleItems()} className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-700 transition active:scale-[.98] hover:bg-emerald-100">
          {open ? "ເຊື່ອງລາຍການ" : "ເບິ່ງລາຍການຄະແນນ"} <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </button>
        )}

        {open && !isRoleComm ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-2 gap-1 border-b border-slate-100 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => switchItemsTab("month")}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition ${itemsTab === "month" ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400"}`}
            >
              ສະສົມ (ເດືອນນີ້)
            </button>
            <button
              type="button"
              onClick={() => switchItemsTab("today")}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition ${itemsTab === "today" ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-400"}`}
            >
              ມື້ນີ້
            </button>
          </div>
          {items === null ? (
            <div className="py-6 text-center text-xs text-slate-400">ກຳລັງໂຫລດ…</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">ຍັງບໍ່ມີລາຍການຂາຍ</div>
          ) : (() => {
            // Sold items split so the seller SEES which products earn points
            // and which don't.
            const earned = items.filter((it) => it.points > 0);
            const zero = items.filter((it) => it.points <= 0);
            const rows = (list: Item[], got: boolean) =>
              list.map((it, i) => (
                <li key={`${got ? "p" : "z"}-${it.itemName}-${i}`} className={`flex items-center gap-2 px-3 py-2 ${got ? "" : "bg-slate-50/60"}`}>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-bold ${got ? "text-slate-800" : "text-slate-500"}`}>{it.itemName}</span>
                    <span className="text-[11px] text-slate-400">{it.brand}{it.category ? ` · ${it.category}` : ""} · x{fmt.format(it.qty)}</span>
                  </span>
                  {got ? (
                    <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 font-mono text-sm font-black text-emerald-700">+{pointFmt.format(it.points)}</span>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-400">ບໍ່ໄດ້ແຕ້ມ</span>
                  )}
                </li>
              ));
            return (
              <>
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-[10px] font-bold">
                  <span className="text-emerald-700">✓ ໄດ້ແຕ້ມ {fmt.format(earned.length)} ລາຍການ</span>
                  <span className="text-slate-400">✗ ບໍ່ໄດ້ແຕ້ມ {fmt.format(zero.length)} ລາຍການ</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {rows(earned, true)}
                  {zero.length > 0 ? (
                    <li className="bg-slate-100/80 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-400">
                      ຂາຍແລ້ວ ແຕ່ບໍ່ໄດ້ແຕ້ມ
                    </li>
                  ) : null}
                  {rows(zero, false)}
                </ul>
              </>
            );
          })()}
        </div>
        ) : null}
      </div>
    </section>
  );
}

function CommissionCondition({ range, description, tone }: { range: string; description: string; tone: "muted" | "indigo" | "emerald" }) {
  const dot = tone === "emerald" ? "bg-emerald-500" : tone === "indigo" ? "bg-indigo-500" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="w-24 shrink-0 font-black text-slate-700">{range}</span>
      <span className="text-slate-500">{description}</span>
    </div>
  );
}
