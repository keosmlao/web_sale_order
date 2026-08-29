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

// ── Report-page showcase ────────────────────────────────────────────────
// A different garment for the same data: each reward is its own card in a
// grid — the prize as the centrepiece, the target as a progress ring, the
// per-person table folded behind ເບິ່ງລາຍຄົນ. The home page keeps the
// compact RewardList below; only /reports/special-rewards wears this.

function ProgressRing({ pct, achieved }: { pct: number; achieved: boolean }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0">
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        className="text-slate-100"
      />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={achieved ? "#10b981" : "#f59e0b"}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * clamped) / 100}
        transform="rotate(-90 50 50)"
        className="transition-all duration-700"
      />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        className="fill-slate-900 font-mono text-[22px] font-black"
      >
        {pct.toFixed(0)}%
      </text>
    </svg>
  );
}

export function RewardShowcase({
  rewards,
  unitRewards = [],
}: {
  rewards: Reward[];
  unitRewards?: UnitReward[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {rewards.map((r) => {
          const pct = Math.max(0, r.pct * 100);
          const remaining = Math.max(0, r.target - r.current);
          return (
            <section
              key={r.code}
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                r.achieved ? "border-emerald-200" : "border-slate-200"
              }`}
            >
              {/* Card head: what the program is */}
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <span className="min-w-0 truncate text-[13px] font-black text-slate-800">
                  {r.description}
                </span>
                {r.brandCode ? (
                  <span className="shrink-0 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                    {r.brandCode}
                  </span>
                ) : null}
              </div>

              {/* The prize and the ring face each other. */}
              <div className="flex items-center gap-4 px-4 py-4">
                <ProgressRing pct={pct} achieved={r.achieved} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    ລາງວັນ
                  </div>
                  <div
                    className={`font-mono text-2xl font-black leading-tight ${
                      r.achieved ? "text-emerald-600" : "text-slate-900"
                    }`}
                  >
                    {moneyFmt.format(r.reward)}{" "}
                    <small className="text-sm font-bold text-slate-500">
                      ບາດ{r.splitByShare ? " (ແບ່ງຕາມສັດສ່ວນ)" : "/ຄົນ"}
                    </small>
                  </div>
                  <div className="mt-1.5 text-[12px] font-semibold text-slate-500">
                    ຍອດຕອນນີ້{" "}
                    <b className="font-mono text-slate-800">
                      {moneyFmt.format(r.current)}
                    </b>{" "}
                    / {moneyFmt.format(r.target)} ບາດ
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold">
                    {r.achieved ? (
                      <span className="text-emerald-600">
                        🎉 ບັນລຸເປົ້າແລ້ວ — ໄດ້ຮັບລາງວັນ
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        ຂາດອີກ{" "}
                        <b className="font-mono text-slate-600">
                          {moneyFmt.format(remaining)}
                        </b>{" "}
                        ບາດ
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* My slice, when the roster table is not available */}
              {!r.breakdown && r.splitByShare ? (
                <div className="border-t border-slate-100 px-4 py-2.5 text-xs font-bold text-slate-600">
                  ຂ້ອຍຂາຍໄດ້{" "}
                  <b className="font-mono">{moneyFmt.format(r.mine)}</b> ບາດ ={" "}
                  <b className="font-mono text-amber-600">
                    {(r.myShare * 100).toFixed(1)}%
                  </b>{" "}
                  →{" "}
                  <b className="font-mono text-emerald-700">
                    ≈ {moneyFmt.format(Math.round(r.myReward))} ບາດ
                  </b>
                </div>
              ) : null}

              {/* The roster, folded until asked for. */}
              {r.breakdown && r.breakdown.length > 0 ? (
                <details className="group border-t border-slate-100">
                  <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-800">
                    ເບິ່ງລາຍຄົນ ({r.breakdown.length}){" "}
                    <span className="inline-block transition group-open:rotate-180">
                      ▾
                    </span>
                  </summary>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <th className="px-4 py-1.5 text-left">ພະນັກງານ</th>
                        <th className="px-2.5 py-1.5 text-right">ຍອດຂາຍ</th>
                        <th className="px-2.5 py-1.5 text-right">%</th>
                        {r.splitByShare ? (
                          <th className="px-4 py-1.5 text-right">ຈະໄດ້ຮັບ</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.breakdown.map((m) => (
                        <tr
                          key={m.code}
                          className={m.amount > 0 ? "" : "text-slate-400"}
                        >
                          <td className="max-w-40 truncate px-4 py-1.5 font-bold text-slate-700">
                            {m.name}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                            {moneyFmt.format(m.amount)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-black text-amber-600">
                            {(m.share * 100).toFixed(1)}%
                          </td>
                          {r.splitByShare ? (
                            <td className="px-4 py-1.5 text-right font-mono font-black text-emerald-700">
                              {moneyFmt.format(Math.round(m.reward))}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
      {unitRewards.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <RewardList rewards={[]} unitRewards={unitRewards} />
        </div>
      ) : null}
    </div>
  );
}


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

              {/* Managers / unit heads: every member's sales, % share and
                  (for split rewards) their slice of the pot. */}
              {r.breakdown && r.breakdown.length > 0 ? (
                <div className="mt-2 overflow-hidden rounded-xl ring-1 ring-inset ring-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        <th className="px-2.5 py-1.5 text-left">ພະນັກງານ</th>
                        <th className="px-2.5 py-1.5 text-right">ຍອດຂາຍ</th>
                        <th className="px-2.5 py-1.5 text-right">%</th>
                        {r.splitByShare ? (
                          <th className="px-2.5 py-1.5 text-right">ຈະໄດ້ຮັບ</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.breakdown.map((m) => (
                        <tr key={m.code} className={m.amount > 0 ? "" : "text-slate-400"}>
                          <td className="max-w-32 truncate px-2.5 py-1.5 font-bold text-slate-700">
                            {m.name}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-bold">
                            {moneyFmt.format(m.amount)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-black text-amber-600">
                            {(m.share * 100).toFixed(1)}%
                          </td>
                          {r.splitByShare ? (
                            <td className="px-2.5 py-1.5 text-right font-mono font-black text-emerald-700">
                              {moneyFmt.format(Math.round(m.reward))}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
