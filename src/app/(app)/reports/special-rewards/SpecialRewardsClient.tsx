"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RewardList,
  LAO_MONTHS,
  visibleRewards,
  visibleUnitRewards,
  type Reward,
  type UnitReward,
  RewardShowcase,
} from "../../SpecialRewardCard";

// ລາງວັນພິເສດ report — the same reward cards as the home page, but browsable
// month by month (ເບິ່ງຍ້ອນຫຼັງ). Uses the roster + sales of the SELECTED
// month, so a past month shows exactly what that month's program paid on.
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

export default function SpecialRewardsClient() {
  const [period, setPeriod] = useState(currentPeriod);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [unitRewards, setUnitRewards] = useState<UnitReward[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const [year, month] = p.split("-");
      const params = new URLSearchParams({ year, month: String(Number(month)) });
      const res = await fetch(`/api/reports/special-rewards?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rewards: Reward[]; unitRewards?: UnitReward[] };
      setRewards(visibleRewards(Array.isArray(data.rewards) ? data.rewards : []));
      setUnitRewards(visibleUnitRewards(Array.isArray(data.unitRewards) ? data.unitRewards : []));
    } catch {
      setRewards([]);
      setUnitRewards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => void load(period));
  }, [period, load]);

  const shiftMonth = (delta: number) => {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setPeriod(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const [py, pm] = period.split("-").map(Number);
  const monthLabel = `${LAO_MONTHS[pm - 1] ?? pm} ${py}`;
  const isCurrent = period === currentPeriod();

  return (
    <div className="space-y-4 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#003361] via-[#174f87] to-[#2b70b5] px-4 py-4 text-white shadow-lg sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 text-2xl">
            🎁
          </span>
          <div>
            <h1 className="text-lg font-black sm:text-xl">
              ລາງວັນພິເສດ · ເດືອນ{monthLabel}
            </h1>
            <p className="text-xs font-semibold text-white/70">
              ບັນລຸເປົ້າພະແນກ · ຮັບເງິນລາງວັນເພີ່ມ · ເບິ່ງຍ້ອນຫຼັງໄດ້
            </p>
          </div>
          {isCurrent ? (
            <span className="ml-1 hidden rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-black text-emerald-200 sm:inline">
              ເດືອນປັດຈຸບັນ
            </span>
          ) : (
            <span className="ml-1 hidden rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-white/70 sm:inline">
              ຍ້ອນຫຼັງ
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="ເດືອນກ່ອນ"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white transition hover:bg-white/25 active:scale-95"
          >
            ‹
          </button>
          <input
            type="month"
            value={period}
            max={currentPeriod()}
            onChange={(event) => event.target.value && setPeriod(event.target.value)}
            className="h-9 rounded-xl border-0 bg-white/90 px-2.5 text-sm font-bold text-slate-800"
          />
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={isCurrent}
            aria-label="ເດືອນຕໍ່ໄປ"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white transition hover:bg-white/25 active:scale-95 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-400">
          ກຳລັງໂຫລດ…
        </div>
      ) : !rewards || (rewards.length === 0 && unitRewards.length === 0) ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-400">
          ບໍ່ມີໂຄງການລາງວັນພິເສດໃນເດືອນນີ້
        </div>
      ) : (
        <RewardShowcase rewards={rewards} unitRewards={unitRewards} />
      )}

      <p className="text-xs font-semibold text-slate-400">
        * ເປົ້າ ແລະ ເງິນລາງວັນ ເປັນຄ່າທີ່ຕັ້ງໄວ້ປັດຈຸບັນ — ຍອດຂາຍ/ສັດສ່ວນ ຄິດຈາກຂໍ້ມູນຈິງຂອງເດືອນທີ່ເລືອກ
      </p>
    </div>
  );
}
