"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// "🎁 ລາງວັນພິເສດ" — the month's special department rewards (workbook table),
// shown on the home page with the department's live progress toward each
// target. Renders nothing while loading or when no reward is configured.
// The list itself (RewardList) is shared with /reports/special-rewards.
export type RewardMember = {
  code: string;
  name: string;
  amount: number;
  share: number;
  reward: number;
};

export type Reward = {
  code: string;
  description: string;
  brandCode: string | null;
  target: number;
  reward: number;
  splitByShare: boolean;
  current: number;
  mine: number;
  myShare: number;
  myReward: number;
  people: number;
  achieved: boolean;
  pct: number;
  // Present only for managers / unit heads — every roster member's share.
  breakdown?: RewardMember[];
};

export type UnitRewardMember = {
  code: string;
  name: string;
  units: number;
  tier: "high" | "low" | "none";
  pay: number;
};

// Workbook ④/⑤ — per-unit tiered spiffs (sets of a brand / a pushed model),
// paid on each person's OWN monthly count.
export type UnitReward = {
  code: string;
  description: string;
  brandCode: string | null;
  itemMatch: string | null;
  lowMinQty: number;
  lowReward: number;
  highMinQty: number;
  highReward: number;
  totalUnits: number;
  people: number;
  mine: number;
  myTier: "high" | "low" | "none";
  myReward: number;
  breakdown?: UnitRewardMember[];
};

// Programs whose reward amounts are still 0 in the workbook are parked —
// keep them out of the announcement display (settings still lists them).
export const visibleRewards = (rewards: Reward[]) => rewards.filter((r) => r.reward > 0);
export const visibleUnitRewards = (rewards: UnitReward[]) =>
  rewards.filter((r) => r.lowReward > 0 || r.highReward > 0);

const TIER_LABEL: Record<UnitRewardMember["tier"], string> = {
  high: "ເປົ້າສູງ",
  low: "ເປົ້າຕ່ຳ",
  none: "—",
};

const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
// Intl "lo-LA" month names fall back to English on some devices — spell them out.
export const LAO_MONTHS = [
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

// The reward rows themselves — shared between the home card and the
// /reports/special-rewards history page.
export function RewardList({
  rewards,
  unitRewards = [],
}: {
  rewards: Reward[];
  unitRewards?: UnitReward[];
}) {
  const hasSplit = rewards.some((r) => r.splitByShare);
  return (
    <>
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
                {/* The prize is the point — worn as a tag, not a pill
                    fighting the title. */}
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm font-black ${
                    r.achieved
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-900 text-amber-300"
                  }`}
                >
                  🏆 {moneyFmt.format(r.reward)} ບາດ{r.splitByShare ? "" : "/ຄົນ"}
                </span>
              </div>

              {/* Gauge hero: the % carries the story, the figures explain it. */}
              <div className="mt-3 flex items-end gap-4">
                <span
                  className={`font-mono text-3xl font-black leading-none ${
                    r.achieved ? "text-emerald-600" : "text-slate-900"
                  }`}
                >
                  {pct.toFixed(0)}
                  <small className="text-base">%</small>
                </span>
                <div className="min-w-0 flex-1 pb-0.5">
                  <div className="flex items-baseline justify-between text-[11.5px] font-bold text-slate-500">
                    <span>
                      ຍອດຕອນນີ້{" "}
                      <b className="font-mono text-slate-800">
                        {moneyFmt.format(r.current)}
                      </b>{" "}
                      / ເປົ້າ {moneyFmt.format(r.target)} ບາດ
                    </span>
                    {r.achieved ? (
                      <span className="text-emerald-600">🎉 ບັນລຸເປົ້າແລ້ວ</span>
                    ) : (
                      <span>
                        ຂາດອີກ{" "}
                        <b className="font-mono text-slate-700">
                          {moneyFmt.format(remaining)}
                        </b>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        r.achieved
                          ? "bg-emerald-500"
                          : "bg-gradient-to-r from-amber-400 to-orange-500"
                      }`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Managers / unit heads: every member's sales, % share and
                  (for split rewards) their slice of the pot. */}
              {/* The team as a leaderboard: rank, a bar scaled to the top
                  seller, the figures on the right. A race reads faster
                  than a table. */}
              {r.breakdown && r.breakdown.length > 0 ? (
                <ol className="mt-3 flex flex-col gap-1">
                  {(() => {
                    const top = Math.max(
                      1,
                      ...r.breakdown.map((m) => m.amount),
                    );
                    return r.breakdown.map((m, i) => (
                      <li
                        key={m.code}
                        className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                          m.amount > 0 ? "" : "opacity-50"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-black ${
                            i === 0 && m.amount > 0
                              ? "bg-amber-400 text-white"
                              : i === 1 && m.amount > 0
                                ? "bg-slate-300 text-slate-700"
                                : i === 2 && m.amount > 0
                                  ? "bg-orange-300 text-white"
                                  : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-xs font-bold text-slate-700">
                              {m.name}
                            </span>
                            <span className="shrink-0 font-mono text-xs font-bold text-slate-800">
                              {moneyFmt.format(m.amount)}
                              <b className="ml-1.5 font-mono text-[11px] text-amber-600">
                                {(m.share * 100).toFixed(1)}%
                              </b>
                              {r.splitByShare ? (
                                <b className="ml-1.5 font-mono text-[11px] text-emerald-700">
                                  ≈{moneyFmt.format(Math.round(m.reward))}
                                </b>
                              ) : null}
                            </span>
                          </span>
                          <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-slate-100">
                            <span
                              className="block h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400"
                              style={{ width: `${Math.min(100, (m.amount / top) * 100)}%` }}
                            />
                          </span>
                        </span>
                      </li>
                    ));
                  })()}
                </ol>
              ) : null}

              {/* My slice of the pot — split_by_share rewards pay each person
                  their % of the department's qualifying sales. Hidden when the
                  full team breakdown above is shown. */}
              {!r.breakdown && r.splitByShare ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-amber-50/70 px-3 py-2 ring-1 ring-inset ring-amber-100">
                  <span className="text-xs font-bold text-slate-600">
                    ຂ້ອຍຂາຍໄດ້{" "}
                    <b className="font-mono text-slate-900">{moneyFmt.format(r.mine)}</b> ບາດ
                    <span className="text-slate-400"> = </span>
                    <b className="font-mono text-amber-700">{(r.myShare * 100).toFixed(1)}%</b>
                    <span className="text-slate-400"> ຂອງຍອດລວມ</span>
                  </span>
                  <span className="text-xs font-black">
                    {r.achieved ? (
                      <span className="text-emerald-700">
                        ສ່ວນຂອງຂ້ອຍ ≈ {moneyFmt.format(Math.round(r.myReward))} ບາດ
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        ຖ້າບັນລຸເປົ້າ ≈{" "}
                        <b className="font-mono text-amber-700">
                          {moneyFmt.format(Math.round(r.myReward))}
                        </b>{" "}
                        ບາດ
                      </span>
                    )}
                  </span>
                </div>
              ) : null}
            </li>
          );
        })}

        {/* Unit-count spiffs (workbook ④/⑤): each seller's OWN set count picks
            the tier; every set pays that tier's per-unit rate. */}
        {unitRewards.map((r) => {
          const tierChip = (active: boolean) =>
            `rounded-lg px-2 py-1 text-center ring-1 ring-inset ${
              active
                ? "bg-emerald-50 font-black text-emerald-700 ring-emerald-200"
                : "bg-slate-50 font-bold text-slate-500 ring-slate-100"
            }`;
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
                  {r.itemMatch ? (
                    <span className="shrink-0 rounded-md bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-black text-white">
                      ຮຸ່ນ {r.itemMatch}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-bold text-slate-400">
                  ທີມຂາຍແລ້ວ{" "}
                  <b className="font-mono text-slate-700">{moneyFmt.format(r.totalUnits)}</b> ຊຸດ
                </span>
              </div>

              {/* Tier ladder */}
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                <div className={tierChip(r.myTier === "low")}>
                  ≥ {moneyFmt.format(r.lowMinQty)} ຊຸດ →{" "}
                  <span className="font-mono">{moneyFmt.format(r.lowReward)}</span> ບາດ/ຊຸດ
                </div>
                <div className={tierChip(r.myTier === "high")}>
                  ≥ {moneyFmt.format(r.highMinQty)} ຊຸດ →{" "}
                  <span className="font-mono">{moneyFmt.format(r.highReward)}</span> ບາດ/ຊຸດ
                </div>
              </div>

              {/* Managers / unit heads: everyone's count, tier and pay. */}
              {r.breakdown && r.breakdown.length > 0 ? (
                <div className="mt-2 overflow-hidden rounded-xl ring-1 ring-inset ring-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <th className="px-2.5 py-1.5 text-left">ພະນັກງານ</th>
                        <th className="px-2.5 py-1.5 text-right">ຊຸດ</th>
                        <th className="px-2.5 py-1.5 text-right">ຂັ້ນ</th>
                        <th className="px-2.5 py-1.5 text-right">ຈະໄດ້ຮັບ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.breakdown.map((m) => (
                        <tr key={m.code} className={m.units > 0 ? "" : "text-slate-400"}>
                          <td className="max-w-32 truncate px-2.5 py-1.5 font-bold text-slate-700">
                            {m.name}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                            {moneyFmt.format(m.units)}
                          </td>
                          <td className={`px-2.5 py-1.5 text-right font-black ${m.tier === "high" ? "text-emerald-600" : m.tier === "low" ? "text-amber-600" : "text-slate-300"}`}>
                            {TIER_LABEL[m.tier]}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-black text-emerald-700">
                            {moneyFmt.format(Math.round(m.pay))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-amber-50/70 px-3 py-2 ring-1 ring-inset ring-amber-100">
                  <span className="text-xs font-bold text-slate-600">
                    ຂ້ອຍຂາຍໄດ້{" "}
                    <b className="font-mono text-slate-900">{moneyFmt.format(r.mine)}</b> ຊຸດ
                    {r.myTier !== "none" ? (
                      <span className="text-slate-400"> · ຂັ້ນ{TIER_LABEL[r.myTier]}</span>
                    ) : null}
                  </span>
                  <span className="text-xs font-black">
                    {r.myReward > 0 ? (
                      <span className="text-emerald-700">
                        ຈະໄດ້ຮັບ ≈ {moneyFmt.format(Math.round(r.myReward))} ບາດ
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        ຂາຍອີກ{" "}
                        <b className="font-mono text-slate-600">
                          {moneyFmt.format(
                            Math.max(0, (r.lowReward > 0 ? r.lowMinQty : r.highMinQty) - r.mine),
                          )}
                        </b>{" "}
                        ຊຸດ → ເລີ່ມໄດ້ລາງວັນ
                      </span>
                    )}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasSplit ? (
        <div className="border-t border-amber-100 bg-amber-50/50 px-4 py-2 text-[11px] font-semibold text-amber-800">
          * HISENSE: ແບ່ງລາງວັນຕາມ % ສັດສ່ວນຍອດຂາຍຂອງແຕ່ລະຄົນໃນພະແນກ
        </div>
      ) : null}
    </>
  );
}

export default function SpecialRewardCard() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [unitRewards, setUnitRewards] = useState<UnitReward[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reports/special-rewards", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rewards: Reward[]; unitRewards?: UnitReward[] };
        if (!cancelled) {
          setRewards(visibleRewards(Array.isArray(data.rewards) ? data.rewards : []));
          setUnitRewards(visibleUnitRewards(Array.isArray(data.unitRewards) ? data.unitRewards : []));
        }
      } catch {
        if (!cancelled) setRewards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rewards || (rewards.length === 0 && unitRewards.length === 0)) return null;

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
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-700">
            ເດືອນ{currentLaoMonth()}
          </span>
          <Link
            href="/reports/special-rewards"
            className="text-[13px] font-bold text-amber-700 hover:underline"
          >
            ຍ້ອນຫຼັງ ›
          </Link>
        </div>
      </div>
      <RewardList rewards={rewards} unitRewards={unitRewards} />
    </section>
  );
}
