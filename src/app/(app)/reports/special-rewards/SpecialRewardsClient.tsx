"use client";

import { useCallback, useEffect, useState } from "react";
import { RewardList, LAO_MONTHS, type Reward } from "../../SpecialRewardCard";

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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const [year, month] = p.split("-");
      const params = new URLSearchParams({ year, month: String(Number(month)) });
      const res = await fetch(`/api/reports/special-rewards?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rewards: Reward[] };
      setRewards(Array.isArray(data.rewards) ? data.rewards : []);
    } catch {
      setRewards([]);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-xl shadow-sm shadow-amber-300">
            🎁
          </span>
          <div>
            <h1 className="text-lg font-black text-slate-900 sm:text-xl">ລາງວັນພິເສດ</h1>
            <p className="text-xs font-semibold text-slate-500">
              ບັນລຸເປົ້າພະແນກ · ຮັບເງິນລາງວັນເພີ່ມ · ເບິ່ງຍ້ອນຫຼັງໄດ້
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="ເດືອນກ່ອນ"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 active:scale-95"
          >
            ‹
          </button>
          <input
            type="month"
            value={period}
            max={currentPeriod()}
            onChange={(event) => event.target.value && setPeriod(event.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-700"
          />
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={isCurrent}
            aria-label="ເດືອນຕໍ່ໄປ"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 active:scale-95 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-amber-200/70 bg-white shadow-[0_10px_35px_-18px_rgba(217,119,6,0.45)]">
        <div className="flex items-center justify-between border-b border-amber-100 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50/60 px-4 py-2.5">
          <span className="text-sm font-black text-slate-800">
            ເດືອນ{monthLabel}
          </span>
          {isCurrent ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">
              ເດືອນປັດຈຸບັນ
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">
              ຍ້ອນຫຼັງ
            </span>
          )}
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm font-semibold text-slate-400">ກຳລັງໂຫລດ…</div>
        ) : !rewards || rewards.length === 0 ? (
          <div className="py-10 text-center text-sm font-semibold text-slate-400">
            ບໍ່ມີໂຄງການລາງວັນພິເສດໃນເດືອນນີ້
          </div>
        ) : (
          <RewardList rewards={rewards} />
        )}
      </section>

      <p className="text-xs font-semibold text-slate-400">
        * ເປົ້າ ແລະ ເງິນລາງວັນ ເປັນຄ່າທີ່ຕັ້ງໄວ້ປັດຈຸບັນ — ຍອດຂາຍ/ສັດສ່ວນ ຄິດຈາກຂໍ້ມູນຈິງຂອງເດືອນທີ່ເລືອກ
      </p>
    </div>
  );
}
