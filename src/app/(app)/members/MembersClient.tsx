"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export type Member = {
 id: string;
 name: string;
 phone: string | null;
 email: string | null;
 address: string | null;
 groupCode: string | null;
 groupName: string | null;
 discountPct: number;
};

export type TierFacet = { name: string; count: number };

const numFmt = new Intl.NumberFormat("en-US");

function fmtDiscount(pct: number): string {
 if (!Number.isFinite(pct) || pct <= 0) return"—";
 return pct === Math.floor(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

type Props = {
 members: Member[];
 tiers: TierFacet[];
 total: number;
 grandTotal: number;
 page: number;
 pageSize: number;
 query: string;
 tier: string;
};

export default function MembersClient({
 members,
 tiers,
 total,
 grandTotal,
 page,
 pageSize,
 query,
 tier,
}: Props) {
 const router = useRouter();
 const pathname = usePathname();
 const [isPending, startTransition] = useTransition();

 const [searchInput, setSearchInput] = useState(query);

 useEffect(() => {
 if (searchInput === query) return;
 const timer = setTimeout(() => {
 pushParams({ q: searchInput || null, page:"1" });
 }, 300);
 return () => clearTimeout(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [searchInput]);

 function pushParams(patch: Record<string, string | null>) {
 const params = new URLSearchParams();
 if (query) params.set("q", query);
 if (tier && tier !=="ALL") params.set("tier", tier);
 if (page > 1) params.set("page", String(page));
 if (pageSize !== 50) params.set("pageSize", String(pageSize));
 for (const [k, v] of Object.entries(patch)) {
 if (v === null || v ==="" || v ==="ALL") params.delete(k);
 else params.set(k, v);
 }
 const search = params.toString();
 startTransition(() => {
 router.replace(search ? `${pathname}?${search}` : pathname, {
 scroll: false,
 });
 });
 }

 const totalPages = Math.max(1, Math.ceil(total / pageSize));
 const currentPage = Math.min(Math.max(1, page), totalPages);
 const startIdx = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
 const endIdx = Math.min(currentPage * pageSize, total);

 return (
 <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
 {/* Header */}
 <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div>
 <h1 className="text-2xl font-extrabold tracking-tight text-odoo-text-strong">
 ສະມາຊິກລູກຄ້າ
 </h1>
 <p className="mt-1 text-sm text-odoo-text">
 ລາຍຊື່ລູກຄ້າທີ່ຖືກຕັ້ງເປັນສະມາຊິກໃນລະບົບ
 </p>
 </div>
 </div>

 {/* Stat cards */}
 <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
 <StatCard label="ສະມາຊິກທັງໝົດ" value={numFmt.format(grandTotal)} />
 <StatCard label="ປະເພດສະມາຊິກ" value={numFmt.format(tiers.length)} />
 <StatCard label="ໜ້ານີ້" value={numFmt.format(members.length)} />
 <StatCard label="ກອງແລ້ວ" value={numFmt.format(total)} />
 </div>

 {/* Filter bar */}
 <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
 <div className="flex-1">
 <div className="relative">
 <svg
 viewBox="0 0 24 24"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.8"
 strokeLinecap="round"
 strokeLinejoin="round"
 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-odoo-text-muted"
 >
 <circle cx="11" cy="11" r="7" />
 <path d="m21 21-4.3-4.3" />
 </svg>
 <input
 type="text"
 value={searchInput}
 onChange={(e) => setSearchInput(e.target.value)}
 placeholder="ຄົ້ນຫາ ຊື່ / ລະຫັດ / ເບີໂທ / ປະເພດສະມາຊິກ"
 className="odoo-input py-2.5 pl-9 placeholder:text-odoo-text-soft"
 />
 </div>
 </div>
 <div className="flex flex-wrap gap-1.5">
 <TierPill
 label="ທັງໝົດ"
 count={grandTotal}
 active={!tier || tier ==="ALL"}
 onClick={() => pushParams({ tier: null, page:"1" })}
 />
 {tiers.map((t) => (
 <TierPill
 key={t.name}
 label={t.name}
 count={t.count}
 active={tier === t.name}
 onClick={() => pushParams({ tier: t.name, page:"1" })}
 />
 ))}
 </div>
 </div>

 {/* Results */}
 {total === 0 ? (
 <EmptyState />
 ) : (
 <>
 <div
 className={
"odoo-card overflow-hidden transition-opacity" +
 (isPending ? "opacity-60" : "opacity-100")
 }
 >
 {/* Desktop table */}
 <table className="hidden w-full text-sm md:table">
 <thead className="border-b border-odoo-border bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
 <tr>
 <th className="px-4 py-3">ລະຫັດ</th>
 <th className="px-4 py-3">ຊື່</th>
 <th className="px-4 py-3">ເບີໂທ</th>
 <th className="px-4 py-3">ປະເພດສະມາຊິກ</th>
 <th className="px-4 py-3 text-right">ສ່ວນຫຼຸດ</th>
 </tr>
 </thead>
 <tbody>
 {members.map((m, i) => (
 <tr
 key={m.id}
 className={
 i % 2 === 0
 ?"bg-white"
 :"bg-odoo-surface-muted/40"
 }
 >
 <td className="px-4 py-3 font-mono text-xs text-odoo-text">
 {m.id}
 </td>
 <td className="px-4 py-3 font-semibold text-odoo-text-strong">
 {m.name}
 {m.address ? (
 <div className="mt-0.5 text-xs font-normal text-odoo-text-muted">
 {m.address}
 </div>
 ) : null}
 </td>
 <td className="px-4 py-3 text-odoo-text-strong">
 {m.phone ??"—"}
 </td>
 <td className="px-4 py-3">
 {m.groupName ? (
 <TierBadge name={m.groupName} />
 ) : (
 <span className="text-odoo-text-soft">—</span>
 )}
 </td>
 <td className="px-4 py-3 text-right font-semibold tabular-nums text-odoo-text-strong">
 {fmtDiscount(m.discountPct)}
 </td>
 </tr>
 ))}
 </tbody>
 </table>

 {/* Mobile list */}
 <ul className="divide-y divide-odoo-border md:hidden">
 {members.map((m) => (
 <li key={m.id} className="px-4 py-3">
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0">
 <div className="truncate text-sm font-bold text-odoo-text-strong">
 {m.name}
 </div>
 <div className="mt-0.5 text-xs text-odoo-text-muted">
 <span className="font-mono">{m.id}</span>
 {m.phone ? <span> · {m.phone}</span> : null}
 </div>
 {m.address ? (
 <div className="mt-0.5 truncate text-xs text-odoo-text-muted">
 {m.address}
 </div>
 ) : null}
 </div>
 <div className="flex flex-col items-end gap-1">
 {m.groupName ? <TierBadge name={m.groupName} /> : null}
 <span className="text-sm font-bold tabular-nums text-odoo-text-strong">
 {fmtDiscount(m.discountPct)}
 </span>
 </div>
 </div>
 </li>
 ))}
 </ul>
 </div>

 <Pagination
 total={total}
 startIdx={startIdx}
 endIdx={endIdx}
 page={currentPage}
 totalPages={totalPages}
 pageSize={pageSize}
 disabled={isPending}
 onPageChange={(p) => pushParams({ page: String(p) })}
 onPageSizeChange={(s) =>
 pushParams({ pageSize: String(s), page:"1" })
 }
 />
 </>
 )}
 </div>
 );
}

function StatCard({ label, value }: { label: string; value: string }) {
 return (
 <div className="odoo-card px-4 py-3">
 <div className="text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
 {label}
 </div>
 <div className="mt-1 text-xl font-extrabold tabular-nums text-odoo-text-strong">
 {value}
 </div>
 </div>
 );
}

function TierPill({
 label,
 count,
 active,
 onClick,
}: {
 label: string;
 count: number;
 active: boolean;
 onClick: () => void;
}) {
 return (
 <button
 type="button"
 onClick={onClick}
 className={
 active
 ?"inline-flex items-center gap-1.5 rounded-md border border-odoo-border-strong bg-odoo-primary px-3 py-1.5 text-xs font-bold text-white"
 :"inline-flex items-center gap-1.5 rounded-md border border-odoo-border bg-white px-3 py-1.5 text-xs font-bold text-odoo-text-strong hover:border-odoo-border-strong border-odoo-border-strong"
 }
 >
 <span>{label}</span>
 <span
 className={
 active
 ?"rounded bg-white/20 px-1.5 text-xs font-extrabold tabular-nums"
 :"rounded bg-odoo-surface-muted px-1.5 text-xs font-extrabold tabular-nums text-odoo-text-strong"
 }
 >
 {numFmt.format(count)}
 </span>
 </button>
 );
}

function TierBadge({ name }: { name: string }) {
 const lower = name.toLowerCase();
 let cls =
"inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold";
 if (lower.includes("black")) {
 cls +=" bg-odoo-primary text-white";
 } else if (lower.includes("platinum") || lower.includes("plat")) {
 cls +=" bg-odoo-border text-odoo-text-strong";
 } else if (lower.includes("gold")) {
 cls +=
" odoo-pill-warning";
 } else if (lower.includes("silver")) {
 cls +=" bg-odoo-surface-muted text-odoo-text-muted";
 } else {
 cls +=
" odoo-pill-success";
 }
 return <span className={cls}>{name}</span>;
}

function EmptyState() {
 return (
 <div className="odoo-card border-dashed px-6 py-16 text-center">
 <svg
 viewBox="0 0 24 24"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.6"
 strokeLinecap="round"
 strokeLinejoin="round"
 className="mx-auto h-10 w-10 text-odoo-text-soft"
 >
 <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
 <circle cx="9" cy="7" r="4" />
 <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
 <path d="M16 3.13a4 4 0 0 1 0 7.75" />
 </svg>
 <p className="mt-3 text-sm font-bold text-odoo-text-strong">
 ບໍ່ພົບສະມາຊິກ
 </p>
 <p className="mt-1 text-xs text-odoo-text-muted">ລອງປ່ຽນຕົວກອງ ຫຼື ຄຳຄົ້ນຫາ</p>
 </div>
 );
}

function Pagination({
 total,
 startIdx,
 endIdx,
 page,
 totalPages,
 pageSize,
 disabled,
 onPageChange,
 onPageSizeChange,
}: {
 total: number;
 startIdx: number;
 endIdx: number;
 page: number;
 totalPages: number;
 pageSize: number;
 disabled: boolean;
 onPageChange: (p: number) => void;
 onPageSizeChange: (s: number) => void;
}) {
 const pages = pageRange(page, totalPages);

 return (
 <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div className="flex items-center gap-3 text-xs text-odoo-text">
 <span>
 ສະແດງ{""}
 <span className="font-bold tabular-nums text-odoo-text-strong">
 {numFmt.format(startIdx)}–{numFmt.format(endIdx)}
 </span>{""}
 ຈາກ{""}
 <span className="font-bold tabular-nums text-odoo-text-strong">
 {numFmt.format(total)}
 </span>
 </span>
 <div className="flex items-center gap-2">
 <label
 htmlFor="page-size"
 className="hidden text-xs text-odoo-text-muted sm:inline"
 >
 ຕໍ່ໜ້າ
 </label>
 <select
 id="page-size"
 value={pageSize}
 disabled={disabled}
 onChange={(e) => onPageSizeChange(Number(e.target.value))}
 className="rounded-md border border-odoo-border bg-white px-2 py-1 text-xs font-bold text-odoo-text-strong outline-none focus:border-odoo-border-strong disabled:opacity-50 border-odoo-border-strong"
 >
 {PAGE_SIZE_OPTIONS.map((n) => (
 <option key={n} value={n}>
 {n}
 </option>
 ))}
 </select>
 </div>
 </div>

 <div className="flex items-center gap-1">
 <PageButton
 disabled={disabled || page <= 1}
 onClick={() => onPageChange(1)}
 aria-label="ໜ້າທຳອິດ"
 >
 «
 </PageButton>
 <PageButton
 disabled={disabled || page <= 1}
 onClick={() => onPageChange(page - 1)}
 aria-label="ໜ້າກ່ອນ"
 >
 ‹
 </PageButton>
 {pages.map((p, i) =>
 p ==="…" ? (
 <span
 key={`gap-${i}`}
 className="px-2 text-xs text-odoo-text-soft select-none"
 >
 …
 </span>
 ) : (
 <PageButton
 key={p}
 active={p === page}
 disabled={disabled}
 onClick={() => onPageChange(p)}
 aria-label={`ໜ້າ ${p}`}
 aria-current={p === page ? "page" : undefined}
 >
 {p}
 </PageButton>
 ),
 )}
 <PageButton
 disabled={disabled || page >= totalPages}
 onClick={() => onPageChange(page + 1)}
 aria-label="ໜ້າຕໍ່ໄປ"
 >
 ›
 </PageButton>
 <PageButton
 disabled={disabled || page >= totalPages}
 onClick={() => onPageChange(totalPages)}
 aria-label="ໜ້າສຸດທ້າຍ"
 >
 »
 </PageButton>
 </div>
 </div>
 );
}

function PageButton({
 children,
 active,
 disabled,
 onClick,
 ...rest
}: {
 children: React.ReactNode;
 active?: boolean;
 disabled?: boolean;
 onClick?: () => void;
} & Omit<
 React.ButtonHTMLAttributes<HTMLButtonElement>,
"children" |"onClick" |"disabled"
>) {
 const base =
"inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-bold tabular-nums transition";
 let cls: string;
 if (active) {
 cls = `${base} border-odoo-border-strong bg-odoo-primary text-white`;
 } else if (disabled) {
 cls = `${base} border-odoo-border bg-white text-odoo-text-soft cursor-not-allowed`;
 } else {
 cls = `${base} border-odoo-border bg-white text-odoo-text-strong hover:border-odoo-border-strong hover:bg-odoo-surface-muted`;
 }
 return (
 <button
 type="button"
 onClick={onClick}
 disabled={disabled}
 className={cls}
 {...rest}
 >
 {children}
 </button>
 );
}

function pageRange(current: number, total: number): Array<number |"…"> {
 if (total <= 7) {
 return Array.from({ length: total }, (_, i) => i + 1);
 }
 const out: Array<number |"…"> = [1];
 const left = Math.max(2, current - 1);
 const right = Math.min(total - 1, current + 1);
 if (left > 2) out.push("…");
 for (let p = left; p <= right; p++) out.push(p);
 if (right < total - 1) out.push("…");
 out.push(total);
 return out;
}
