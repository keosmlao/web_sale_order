"use client";

import { useEffect, useState } from "react";

// "🎁 ລາງວັນພິເສດ" — the month's special department rewards (workbook table),
// shown on the home page with the department's live progress toward each
// target. Renders nothing while loading or when no reward is configured.
type Reward = {
  code: string;
  description: string;
  brandCode: string | null;
  target: number;
  reward: number;
  splitByShare: boolean;
  current: number;
  people: number;
  achieved: boolean;
  pct: number;
};

const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
// Intl "lo-LA" month names fall back to English on some devices — spell them out.
const LAO_MONTHS = [
  "ມັງກອນ", "ກຸມພາ", "ມີນາ", "ເມສາ", "ພຶດສະພາ", "ມິຖຸນາ",
  "ກໍລະກົດ", "ສິງຫາ", "ກັນຍາ", "ຕຸລາ", "ພະຈິກ", "ທັນວາ",
];
const currentLaoMonth = () => {
  const m = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    month: "numeric",
  }).format(new Date());
  return LAO_MONTHS[Number(m) - 1] ?? m;
};

export default function SpecialRewardCard() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reports/special-rewards", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rewards: Reward[] };
        if (!cancelled) setRewards(Array.isArray(data.rewards) ? data.rewards : []);
      } catch {
        if (!cancelled) setRewards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rewards || rewards.length === 0) return null;

  const hasSplit = rewards.some((r) => r.splitByShare);

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200/70 bg-white shadow-[0_10px_35px_-18px_rgba(217,119,6,0.45)]">
      <div className="flex items-center justify-between border-b border-amber-100 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-lg shadow-sm shadow-amber-300">
            🎁
          </span>
          <div>
            <div className="text-base font-black text-slate-900">ລາງວັນພິເສດ</div>
            <div className="text-xs font-semibold text-slate-500">
              ບັນລຸເປົ້າພະແນກ · ຮັບເງິນລາງວັນເພີ່ມ
            </div>
          </div>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-700">
          ເດືອນ{currentLaoMonth()}
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {rewards.map((r) => {
          const pct = Math.max(0, r.pct * 100);
          const fillPct = Math.min(100, Math.max(pct > 0 ? 3 : 0, pct));
          const remaining = Math.max(0, r.target - r.current);
          return (
            <li key={r.code} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-black text-slate-800">
                    {r.description}
                  </span>
                  {r.brandCode ? (
                    <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                      {r.brandCode}
                    </span>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-sm font-black ${
                    r.achieved
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-indigo-50 text-indigo-700"
                  }`}
                >
                  {moneyFmt.format(r.reward)} ບາດ{r.splitByShare ? "" : "/ຄົນ"}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500">
                <span>
                  ຍອດຕອນນີ້{" "}
                  <b className="font-mono text-slate-800">{moneyFmt.format(r.current)}</b>
                  <span className="text-slate-400"> / ເປົ້າ {moneyFmt.format(r.target)} ບາດ</span>
                </span>
                <span className={`font-mono font-black ${r.achieved ? "text-emerald-600" : "text-amber-600"}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    r.achieved
                      ? "bg-emerald-500"
                      : "bg-gradient-to-r from-amber-400 to-orange-500"
                  }`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
              <div className="mt-1 text-xs font-semibold">
                {r.achieved ? (
                  <span className="text-emerald-600">🎉 ບັນລຸເປົ້າແລ້ວ — ໄດ້ຮັບລາງວັນ</span>
                ) : (
                  <span className="text-slate-400">
                    ຂາດອີກ{" "}
                    <b className="font-mono text-slate-600">{moneyFmt.format(remaining)}</b> ບາດ
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {hasSplit ? (
        <div className="border-t border-amber-100 bg-amber-50/50 px-4 py-2 text-[11px] font-semibold text-amber-800">
          * HISENSE: ແບ່ງລາງວັນຕາມ % ສັດສ່ວນຍອດຂາຍຂອງແຕ່ລະຄົນໃນພະແນກ
        </div>
      ) : null}
    </section>
  );
}
