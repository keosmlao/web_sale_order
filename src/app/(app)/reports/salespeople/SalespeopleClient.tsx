"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

// One employee's realised receipt sales (baht) broken down by 'YYYY-MM' month.
export type MonthlyReceiptRow = {
 code: string;
 displayName: string;
 positionCode: string | null;
 total: number;
 target: number;
 ytdActual: number;
 ytdTarget: number;
};

// Achievement colour tiers (mirror the commission tiers: <80% red, 80-99% amber,
// ≥100% green).
function achievementClass(pct: number): string {
 if (pct >= 100) return "text-emerald-600";
 if (pct >= 80) return "text-amber-600";
 return "text-odoo-danger";
}

// Thin progress bar under the % values — same colour tiers.
function PctBar({ pct }: { pct: number }) {
 const fill = pct >= 100 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-400" : "bg-rose-400";
 return (
  <div className="mt-1 h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-slate-100">
   <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
  </div>
 );
}

type Filters = { from: string; to: string };

const moneyFmt = new Intl.NumberFormat("en-US", {
 minimumFractionDigits: 0,
 maximumFractionDigits: 0,
});

const POSITION_LABEL: Record<string, string> = {
"11":"ຜູ່ຈັດການ",
"12":"ຫົວໜ້າພະນັກງານຂາຍ",
"13":"ພະນັກງານຂາຍ",
};

export default function SalespeopleClient({
 grandReceipts,
 grandTarget,
 grandBills,
 daysLeft,
 monthly,
 filters,
}: {
 grandReceipts: number;
 grandTarget: number;
 grandBills: number;
 daysLeft: number | null;
 monthly: MonthlyReceiptRow[];
 filters: Filters;
}) {
 const router = useRouter();
 const pathname = usePathname();
 const [, startTransition] = useTransition();

 function pushFilters(patch: Partial<Record<keyof Filters, string | null>>) {
 const params = new URLSearchParams();
 if (filters.from) params.set("from", filters.from);
 if (filters.to) params.set("to", filters.to);
 for (const [k, v] of Object.entries(patch)) {
 if (v === null || v ==="") params.delete(k);
 else params.set(k, v);
 }
 const qs = params.toString();
 startTransition(() => {
 router.push(qs ? `${pathname}?${qs}` : pathname);
 });
 }

 // Top 3 medal colours for the leaderboard ranking.
 const medal = (i: number): string => {
 if (i === 0) return"bg-odoo-primary text-white";
 if (i === 1) return"bg-odoo-primary-100 text-odoo-primary";
 if (i === 2) return"bg-odoo-surface-muted text-odoo-text-strong";
 return"bg-odoo-surface-muted text-odoo-text-muted";
 };

 return (
 <div className="odoo-page">
 <div className="odoo-page-header">
 <div>
 <h1 className="odoo-page-title">ຍອດຂາຍຈິງຕາມພະນັກງານ</h1>
 <p className="odoo-page-subtitle">
 {filters.from} → {filters.to} · ໜ້າຮ້ານ ຂົວຫຼວງ
 </p>
 </div>
 <div className="odoo-card flex flex-wrap gap-6 px-4 py-3 text-right w-full sm:w-auto">
 <div className="min-w-0">
 <div className="odoo-label mb-1">ຍອດຂາຍຈິງ (ບາດ)</div>
 <div className="font-mono text-xl font-bold text-odoo-primary">{moneyFmt.format(grandReceipts)}</div>
 </div>
 <div className="min-w-0">
 <div className="odoo-label mb-1">ເປົ້າໝາຍ (ບາດ)</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{moneyFmt.format(grandTarget)}</div>
 </div>
 <div className="min-w-0">
 <div className="odoo-label mb-1">ບັນລຸ</div>
 <div className={`font-mono text-xl font-bold ${grandTarget > 0 ? achievementClass((grandReceipts / grandTarget) * 100) : "text-odoo-text-muted"}`}>
 {grandTarget > 0 ? `${((grandReceipts / grandTarget) * 100).toFixed(1)}%` : "—"}
 </div>
 </div>
 <div className="min-w-0">
 <div className="odoo-label mb-1">ບິນ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{moneyFmt.format(grandBills)}</div>
 </div>
 <div className="min-w-0">
 <div className="odoo-label mb-1">ສະເລ່ຍ/ບິນ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">
 {moneyFmt.format(grandBills > 0 ? grandReceipts / grandBills : 0)}
 </div>
 </div>
 </div>
 </div>

 {/* Filters — date range + quick presets */}
 <section className="odoo-card p-4">
 <div className="flex flex-wrap items-end gap-3">
 <div className="w-full sm:w-auto">
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຈາກວັນທີ
 </label>
 <input
 type="date"
 defaultValue={filters.from}
 onChange={(e) => pushFilters({ from: e.target.value || null })}
 className="odoo-input mt-1 w-full sm:w-auto"
 />
 </div>
 <div className="w-full sm:w-auto">
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຫາວັນທີ
 </label>
 <input
 type="date"
 defaultValue={filters.to}
 onChange={(e) => pushFilters({ to: e.target.value || null })}
 className="odoo-input mt-1 w-full sm:w-auto"
 />
 </div>
 <div className="flex flex-wrap items-end gap-2 w-full sm:w-auto sm:ml-auto">
 <QuickRangeButton label="ມື້ນີ້" onClick={() => pushFilters(todayRange())} />
 <QuickRangeButton label="7 ມື້" onClick={() => pushFilters(lastNDaysRange(7))} />
 <QuickRangeButton label="30 ມື້" onClick={() => pushFilters(lastNDaysRange(30))} />
 <QuickRangeButton label="ເດືອນນີ້" onClick={() => pushFilters(thisMonthRange())} />
 <QuickRangeButton label="ປີນີ້" onClick={() => pushFilters(thisYearRange())} />
 </div>
 </div>
 </section>

 {/* Monthly realised-sales pivot (baht) */}
 <section className="odoo-card mt-4 overflow-hidden">
 <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
 <h2 className="text-sm font-bold text-odoo-text-strong">
 ສະຫຼຸບຍອດຂາຍຈິງ ລາຍເດືອນ (ບາດ)
 </h2>
 <span className="text-[11px] text-odoo-text-muted">
 ໃບຮັບເງິນ · ສາຂາຂົວຫຼວງ · ທີມໜ້າຮ້ານ
 </span>
 </div>
 <div className="overflow-x-auto">
 <table className="odoo-table min-w-[880px]">
 <thead>
 <tr>
 <th className="px-3 py-3 text-center">#</th>
 <th className="px-4 py-3">ພະນັກງານ</th>
 <th className="px-4 py-3 text-right whitespace-nowrap">ເປົ້າ</th>
 <th className="px-4 py-3 text-right whitespace-nowrap">ຍອດຂາຍ</th>
 <th className="px-4 py-3 text-center">Ach%</th>
 <th className="px-4 py-3 text-center">Days</th>
 <th className="px-4 py-3 text-right whitespace-nowrap">Req/Day</th>
 <th className="px-4 py-3 text-right whitespace-nowrap text-odoo-text-muted">YTD Target</th>
 <th className="px-4 py-3 text-right whitespace-nowrap text-odoo-text-muted">YTD Actual</th>
 <th className="px-4 py-3 text-right whitespace-nowrap">YTD%</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-odoo-border">
 {monthly.length === 0 ? (
 <tr>
 <td colSpan={10} className="px-4 py-12 text-center text-sm text-odoo-text-muted">
 ບໍ່ມີໃບຮັບເງິນໃນຊ່ວງວັນທີນີ້
 </td>
 </tr>
 ) : (
 monthly.map((r, i) => {
 const ach = r.target > 0 ? (r.total / r.target) * 100 : 0;
 const reqPerDay = daysLeft ? (r.target - r.total) / daysLeft : null;
 const ytdPct = r.ytdTarget > 0 ? (r.ytdActual / r.ytdTarget) * 100 : 0;
 return (
 <tr key={r.code} className="text-odoo-text-strong">
 <td className="px-3 py-3 text-center">
 <span className={`inline-flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold ${medal(i)}`}>
 {i + 1}
 </span>
 </td>
 <td className="px-4 py-3">
 <div className="font-semibold text-odoo-text-strong">{r.displayName}</div>
 <div className="text-[10px] text-odoo-text-muted">
 <span className="font-mono">{r.code}</span>
 {r.positionCode ? (
 <>
 {" ·"}
 {POSITION_LABEL[r.positionCode] ?? `pos ${r.positionCode}`}
 </>
 ) : null}
 </div>
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs">
 {r.target > 0 ? moneyFmt.format(r.target) : "—"}
 </td>
 <td className="px-4 py-3 text-right font-mono font-bold text-odoo-primary">
 {moneyFmt.format(r.total)}
 </td>
 <td className="px-4 py-3 text-center">
 {r.target > 0 ? (
 <>
 <span className={`inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-bold ${
 ach >= 100 ? "bg-emerald-50 text-emerald-600" : ach >= 80 ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"
 }`}>
 {ach.toFixed(1)}%
 </span>
 <PctBar pct={ach} />
 </>
 ) : (
 <span className="text-odoo-text-muted">—</span>
 )}
 </td>
 <td className="px-4 py-3 text-center font-mono text-xs text-odoo-text-muted">
 {daysLeft ?? "—"}
 </td>
 <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${
 reqPerDay === null ? "text-odoo-text-muted" : reqPerDay <= 0 ? "text-emerald-600" : "text-odoo-primary"
 }`}>
 {reqPerDay === null || r.target <= 0 ? "—" : moneyFmt.format(Math.round(reqPerDay))}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs text-odoo-text-muted">
 {r.ytdTarget > 0 ? moneyFmt.format(r.ytdTarget) : "—"}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs text-odoo-text-muted">
 {moneyFmt.format(r.ytdActual)}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs font-bold">
 {r.ytdTarget > 0 ? (
 <>
 <span className={achievementClass(ytdPct)}>{ytdPct.toFixed(0)}%</span>
 <PctBar pct={ytdPct} />
 </>
 ) : (
 <span className="text-odoo-text-muted">—</span>
 )}
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 {monthly.length > 0 ? (
 <tfoot className="border-t border-odoo-border bg-odoo-surface-muted text-xs font-bold">
 <tr>
 <td className="px-3 py-3"></td>
 <td className="px-4 py-3 text-odoo-text-strong">ລວມທັງໝົດ</td>
 <td className="px-4 py-3 text-right font-mono">
 {grandTarget > 0 ? moneyFmt.format(grandTarget) : "—"}
 </td>
 <td className="px-4 py-3 text-right font-mono text-base text-odoo-primary">
 {moneyFmt.format(grandReceipts)}
 </td>
 <td className="px-4 py-3 text-center font-mono">
 {grandTarget > 0 ? (
 <span className={achievementClass((grandReceipts / grandTarget) * 100)}>
 {((grandReceipts / grandTarget) * 100).toFixed(1)}%
 </span>
 ) : (
 <span className="text-odoo-text-muted">—</span>
 )}
 </td>
 <td className="px-4 py-3 text-center font-mono text-odoo-text-muted">{daysLeft ?? "—"}</td>
 <td className="px-4 py-3 text-right font-mono">
 {daysLeft && grandTarget > 0 ? moneyFmt.format(Math.round((grandTarget - grandReceipts) / daysLeft)) : "—"}
 </td>
 <td className="px-4 py-3 text-right font-mono text-odoo-text-muted">
 {moneyFmt.format(monthly.reduce((s, r) => s + r.ytdTarget, 0))}
 </td>
 <td className="px-4 py-3 text-right font-mono text-odoo-text-muted">
 {moneyFmt.format(monthly.reduce((s, r) => s + r.ytdActual, 0))}
 </td>
 <td className="px-4 py-3 text-right font-mono">
 {(() => {
 const tt = monthly.reduce((s, r) => s + r.ytdTarget, 0);
 const ta = monthly.reduce((s, r) => s + r.ytdActual, 0);
 return tt > 0 ? (
 <span className={achievementClass((ta / tt) * 100)}>{((ta / tt) * 100).toFixed(0)}%</span>
 ) : (
 <span className="text-odoo-text-muted">—</span>
 );
 })()}
 </td>
 </tr>
 </tfoot>
 ) : null}
 </table>
 </div>
 </section>
 </div>
 );
}

function QuickRangeButton({ label, onClick }: { label: string; onClick: () => void }) {
 return (
 <button
 type="button"
 onClick={onClick}
 className="odoo-btn odoo-btn-secondary"
 >
 {label}
 </button>
 );
}

function todayRange(): Partial<Record<keyof Filters, string>> {
 const t = new Date().toISOString().slice(0, 10);
 return { from: t, to: t };
}

function lastNDaysRange(n: number): Partial<Record<keyof Filters, string>> {
 const to = new Date();
 const from = new Date();
 from.setDate(from.getDate() - (n - 1));
 return {
 from: from.toISOString().slice(0, 10),
 to: to.toISOString().slice(0, 10),
 };
}

function thisMonthRange(): Partial<Record<keyof Filters, string>> {
 const now = new Date();
 const from = new Date(now.getFullYear(), now.getMonth(), 1);
 return {
 from: from.toISOString().slice(0, 10),
 to: now.toISOString().slice(0, 10),
 };
}

function thisYearRange(): Partial<Record<keyof Filters, string>> {
 const now = new Date();
 const from = new Date(now.getFullYear(), 0, 1);
 return {
 from: from.toISOString().slice(0, 10),
 to: now.toISOString().slice(0, 10),
 };
}
