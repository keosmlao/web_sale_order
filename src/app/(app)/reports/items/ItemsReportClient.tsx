"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

export type ItemStat = {
 itemCode: string;
 itemName: string | null;
 unitName: string | null;
 brandName: string | null;
 orderCount: number;
 totalQty: number;
 totalAmount: number;
};

type Filters = {
 from: string;
 to: string;
 status:"ACTIVE" |"ALL";
 limit: number;
 q: string;
};

const moneyFmt = new Intl.NumberFormat("en-US", {
 minimumFractionDigits: 0,
 maximumFractionDigits: 0,
});

const qtyFmt = new Intl.NumberFormat("en-US", {
 minimumFractionDigits: 0,
 maximumFractionDigits: 2,
});

export default function ItemsReportClient({
 items,
 grandTotal,
 grandQty,
 filters,
}: {
 items: ItemStat[];
 grandTotal: number;
 grandQty: number;
 filters: Filters;
}) {
 const router = useRouter();
 const pathname = usePathname();
 const [, startTransition] = useTransition();

 const [search, setSearch] = useState(filters.q);

 useEffect(() => {
 if (search === filters.q) return;
 const t = setTimeout(() => pushFilters({ q: search || null }), 300);
 return () => clearTimeout(t);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [search]);

 function pushFilters(patch: Partial<Record<keyof Filters |"q", string | null>>) {
 const params = new URLSearchParams();
 if (filters.from) params.set("from ", filters.from);
 if (filters.to) params.set("to", filters.to);
 if (filters.status && filters.status !=="ACTIVE") params.set("status", filters.status);
 if (filters.limit && filters.limit !== 50) params.set("limit", String(filters.limit));
 if (filters.q) params.set("q", filters.q);
 for (const [k, v] of Object.entries(patch)) {
 if (v === null || v ==="") params.delete(k);
 else params.set(k, v);
 }
 const qs = params.toString();
 startTransition(() => {
 router.push(qs ? `${pathname}?${qs}` : pathname);
 });
 }

 const topAmount = items[0]?.totalAmount ?? 0;

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
 <h1 className="odoo-page-title">ສິນຄ້າຂາຍດີ</h1>
 <p className="odoo-page-subtitle">{filters.from} → {filters.to}</p>
 </div>
 <div className="odoo-card flex flex-wrap gap-6 px-4 py-3 text-right">
 <div>
 <div className="odoo-label mb-1">ລວມ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{moneyFmt.format(grandTotal)}</div>
 </div>
 <div>
 <div className="odoo-label mb-1">ຈຳນວນ</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{qtyFmt.format(grandQty)}</div>
 </div>
 <div>
 <div className="odoo-label mb-1">Top</div>
 <div className="font-mono text-xl font-bold text-odoo-text-strong">{filters.limit}</div>
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
 <div>
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຈຳນວນ Top
 </label>
 <select
 defaultValue={filters.limit}
 onChange={(e) => pushFilters({ limit: e.target.value })}
 className="odoo-select mt-1"
 >
 {[20, 50, 100, 200, 500].map((n) => (
 <option key={n} value={n}>
 Top {n}
 </option>
 ))}
 </select>
 </div>
 <div className="flex-1 min-w-60">
 <label className="block text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
 ຄົ້ນຫາ
 </label>
 <input
 type="text"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="ລະຫັດ / ຊື່ສິນຄ້າ / ຍີ່ຫໍ້"
 className="odoo-input mt-1"
 />
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
 <th className="px-4 py-3">ສິນຄ້າ</th>
 <th className="px-4 py-3">ຍີ່ຫໍ້</th>
 <th className="px-4 py-3 text-right">ບິນ</th>
 <th className="px-4 py-3 text-right">ຈຳນວນ</th>
 <th className="px-4 py-3 text-right">ຍອດຂາຍ</th>
 <th className="px-4 py-3">% ຂອງລວມ</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-odoo-border">
 {items.length === 0 ? (
 <tr>
 <td
 colSpan={7}
 className="px-4 py-16 text-center text-sm text-odoo-text-muted"
 >
 ບໍ່ມີຂໍ້ມູນ
 </td>
 </tr>
 ) : (
 items.map((it, i) => {
 const pct = grandTotal > 0 ? (it.totalAmount / grandTotal) * 100 : 0;
 const barPct = topAmount > 0 ? (it.totalAmount / topAmount) * 100 : 0;
 return (
 <tr
 key={it.itemCode}
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
 {it.itemName ?? it.itemCode}
 </div>
 <div className="font-mono text-[10px] text-odoo-text-soft">
 {it.itemCode}
 {it.unitName ? ` · ${it.unitName}` :""}
 </div>
 </td>
 <td className="px-4 py-3 text-xs text-odoo-text">
 {it.brandName ??"—"}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs">
 {moneyFmt.format(it.orderCount)}
 </td>
 <td className="px-4 py-3 text-right font-mono text-xs font-bold">
 {qtyFmt.format(it.totalQty)}
 </td>
 <td className="px-4 py-3 text-right font-mono font-bold">
 {moneyFmt.format(it.totalAmount)}
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
 {items.length > 0 ? (
 <tfoot className="border-t border-odoo-border bg-odoo-surface-muted text-xs font-bold">
 <tr>
 <td className="px-3 py-3"></td>
 <td className="px-4 py-3 text-odoo-text-strong">
 ລວມ (Top {items.length})
 </td>
 <td></td>
 <td></td>
 <td className="px-4 py-3 text-right font-mono">
 {qtyFmt.format(grandQty)}
 </td>
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
