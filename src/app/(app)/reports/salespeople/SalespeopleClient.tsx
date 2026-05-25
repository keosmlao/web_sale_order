"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

export type SalespersonStat = {
 userOwner: string | null;
 employeeCode: string | null;
 displayName: string;
 positionCode: string | null;
 pendingCount: number;
 completedCount: number;
 cancelledCount: number;
 pendingAmount: number;
 completedAmount: number;
 cancelledAmount: number;
 activeTotal: number; // pending + completed
 activeOrders: number;
 avgOrderValue: number;
};

type Filters = { from: string; to: string; status:"ACTIVE" |"ALL" };

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
 stats,
 grandTotal,
 grandOrders,
 filters,
}: {
 stats: SalespersonStat[];
 grandTotal: number;
 grandOrders: number;
 filters: Filters;
}) {
 const router = useRouter();
 const pathname = usePathname();
 const [, startTransition] = useTransition();

 function pushFilters(patch: Partial<Record<keyof Filters, string | null>>) {
 const params = new URLSearchParams();
 if (filters.from) params.set("from ", filters.from);
 if (filters.to) params.set("to", filters.to);
 if (filters.status && filters.status !=="ACTIVE") params.set("status", filters.status);
 for (const [k, v] of Object.entries(patch)) {
 if (v === null || v ==="") params.delete(k);
 else params.set(k, v);
 }
 const qs = params.toString();
 startTransition(() => {
 router.push(qs ? `${pathname}?${qs}` : pathname);
 });
 }

 // Top 3 medal colors for visual ranking.
 const medal = (i: number): string => {
 if (i === 0) return"bg-odoo-primary text-white";
 if (i === 1) return"bg-odoo-primary-100 text-odoo-primary";
 if (i === 2) return"bg-odoo-surface-muted text-odoo-text-strong";
 return"bg-odoo-surface-muted text-odoo-text-muted";
 };

 // Best for the progress bar baseline so #1 stretches across full width.
 const topAmount = stats[0]?.activeTotal ?? 0;

 return (
 <div className="odoo-page">
 <div className="odoo-page-header">
 <div>
 <h1 className="odoo-page-title">ຍອດຂາຍຕາມພະນັກງານ</h1>
 <p className="odoo-page-subtitle">{filters.from} → {filters.to}</p>
 </div>
 <div className="odoo-card flex flex-wrap gap-6 px-4 py-3 text-right">
 <div>
 <div className="odoo-label mb-1">ລວມ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{moneyFmt.format(grandTotal)}</div>
 </div>
 <div>
 <div className="odoo-label mb-1">ບິນ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{moneyFmt.format(grandOrders)}</div>
 </div>
 <div>
 <div className="odoo-label mb-1">ສະເລ່ຍ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">
 {moneyFmt.format(grandOrders > 0 ? grandTotal / grandOrders : 0)}
 </div>
 </div>
 </div>
 </div>

 {/* Filters */}
 <section className="odoo-card p-4">
 <div className="flex flex-wrap items-end gap-3">
 <div>
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຈາກວັນທີ
 </label>
 <input
 type="date"
 defaultValue={filters.from}
 onChange={(e) => pushFilters({ from: e.target.value || null })}
 className="odoo-input mt-1"
 />
 </div>
 <div>
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຫາວັນທີ
 </label>
 <input
 type="date"
 defaultValue={filters.to}
 onChange={(e) => pushFilters({ to: e.target.value || null })}
 className="odoo-input mt-1"
 />
 </div>
 <div>
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຂອບເຂດ
 </label>
 <div className="odoo-segmented mt-1">
 <button
 type="button"
 onClick={() => pushFilters({ status: null })}
 className={
"odoo-segment" +
 (filters.status ==="ACTIVE"
 ?" odoo-segment-active"
 :"")
 }
 >
 ບໍ່ນັບຍົກເລີກ
 </button>
 <button
 type="button"
 onClick={() => pushFilters({ status:"ALL" })}
 className={
"odoo-segment" +
 (filters.status ==="ALL"
 ?" odoo-segment-active"
 :"")
 }
 >
 ນັບລວມຍົກເລີກ
 </button>
 </div>
 </div>
 <div className="ml-auto flex items-end gap-2">
 <QuickRangeButton label="ມື້ນີ້" onClick={() => pushFilters(todayRange())} />
 <QuickRangeButton label="7 ມື້" onClick={() => pushFilters(lastNDaysRange(7))} />
 <QuickRangeButton label="30 ມື້" onClick={() => pushFilters(lastNDaysRange(30))} />
 <QuickRangeButton label="ເດືອນນີ້" onClick={() => pushFilters(thisMonthRange())} />
 </div>
 </div>
 </section>

 {/* Table */}
 <section className="odoo-card mt-4 overflow-hidden">
 <div className="overflow-x-auto">
 <table className="odoo-table min-w-[900px]">
 <thead>
 <tr>
 <th className="px-3 py-3 text-center">#</th>
 <th className="px-4 py-3">ພະນັກງານ</th>
 <th className="px-4 py-3 text-right">ບິນ</th>
 <th className="px-4 py-3 text-right">ລໍຖ້າ</th>
 <th className="px-4 py-3 text-right">ຊຳລະແລ້ວ</th>
 {filters.status ==="ALL" ? (
 <th className="px-4 py-3 text-right">ຍົກເລີກ</th>
 ) : null}
 <th className="px-4 py-3 text-right">ສະເລ່ຍ/ບິນ</th>
 <th className="px-4 py-3 text-right">ລວມ</th>
 <th className="px-4 py-3">% ຂອງລວມ</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-odoo-border">
 {stats.length === 0 ? (
 <tr>
 <td
 colSpan={filters.status ==="ALL" ? 9 : 8}
 className="px-4 py-16 text-center text-sm text-odoo-text-muted"
 >
 ບໍ່ມີຂໍ້ມູນໃນຊ່ວງວັນທີນີ້
 </td>
 </tr>
 ) : (
 stats.map((s, i) => {
 const pct = grandTotal > 0 ? (s.activeTotal / grandTotal) * 100 : 0;
 const barPct = topAmount > 0 ? (s.activeTotal / topAmount) * 100 : 0;
 return (
 <tr
 key={s.userOwner ?? s.displayName + i}
 className="text-odoo-text-strong"
 >
 <td className="px-3 py-3 text-center">
 <span
 className={`inline-flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold ${medal(i)}`}
 >
 {i + 1}
 </span>
 </td>
 <td className="px-4 py-3">
 <div className="font-semibold text-odoo-text-strong">
 {s.displayName}
 </div>
 <div className="text-[10px] text-odoo-text-muted">
 {s.userOwner ? (
 <span className="font-mono">{s.userOwner}</span>
 ) : (
 <span className="italic">ບໍ່ມີລະຫັດ</span>
 )}
 {s.positionCode ? (
 <>
 {" ·"}
 {POSITION_LABEL[s.positionCode] ?? `pos ${s.positionCode}`}
 </>
 ) : null}
 </div>
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs">
 {moneyFmt.format(s.activeOrders)}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs text-odoo-warning">
 {s.pendingCount > 0
 ? `${moneyFmt.format(s.pendingCount)} · ${moneyFmt.format(s.pendingAmount)}`
 :"—"}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs text-odoo-success">
 {s.completedCount > 0
 ? `${moneyFmt.format(s.completedCount)} · ${moneyFmt.format(s.completedAmount)}`
 :"—"}
 </td>
 {filters.status ==="ALL" ? (
 <td className="px-4 py-3 text-right font-mono text-xs text-odoo-danger">
 {s.cancelledCount > 0
 ? `${moneyFmt.format(s.cancelledCount)} · ${moneyFmt.format(s.cancelledAmount)}`
 :"—"}
 </td>
 ) : null}
 <td className="px-4 py-3 text-right font-mono text-xs text-odoo-text">
 {moneyFmt.format(s.avgOrderValue)}
 </td>
 <td className="px-4 py-3 text-right font-mono font-bold">
 {moneyFmt.format(s.activeTotal)}
 </td>
 <td className="px-4 py-3">
 <div className="flex items-center gap-2">
 <div className="odoo-progress w-32">
 <div
 className="odoo-progress-bar"
 style={{ width: `${barPct.toFixed(1)}%` }}
 />
 </div>
 <span className="w-12 text-right font-mono text-[10px] text-odoo-text-muted">
 {pct.toFixed(1)}%
 </span>
 </div>
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 {stats.length > 0 ? (
 <tfoot className="border-t border-odoo-border bg-odoo-surface-muted text-xs font-bold">
 <tr>
 <td className="px-3 py-3"></td>
 <td className="px-4 py-3 text-odoo-text-strong">
 ລວມທັງໝົດ
 </td>
 <td className="px-4 py-3 text-right font-mono">
 {moneyFmt.format(grandOrders)}
 </td>
 <td colSpan={filters.status ==="ALL" ? 4 : 3}></td>
 <td className="px-4 py-3 text-right font-mono text-base font-bold">
 {moneyFmt.format(grandTotal)}
 </td>
 <td></td>
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
