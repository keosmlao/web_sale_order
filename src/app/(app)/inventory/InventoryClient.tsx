"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type Item = {
  code: string;
  nameLo: string | null;
  nameEng: string | null;
  unitName: string | null;
  brand: string | null;
  category: string | null;
  companyBalance: number;
  salePriceKip: number;
};

type StockLocation = {
  warehouse: string | null;
  warehouseName: string | null;
  location: string | null;
  locationName: string | null;
  balanceQty: number;
};

const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const PAGE_SIZE = 50;
const COLS = 6;

// Colour-code on-hand qty so low stock pops at a glance.
function stockTone(qty: number): { dot: string; text: string; bg: string; ring: string } {
  if (qty <= 5)
    return { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", ring: "ring-rose-200" };
  if (qty <= 20)
    return { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200" };
  return { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200" };
}

// Stable per-item avatar colour so the rows feel lively but deterministic.
const AVATARS = [
  "bg-indigo-100 text-indigo-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-sky-100 text-sky-600",
  "bg-violet-100 text-violet-600",
  "bg-rose-100 text-rose-600",
  "bg-teal-100 text-teal-600",
];
function avatarTone(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export default function InventoryClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [locCache, setLocCache] = useState<
    Record<string, StockLocation[] | "loading" | "error">
  >({});

  // Debounce text box → applied query, reset to page 1 on a new term.
  useEffect(() => {
    const h = setTimeout(
      () => {
        setQuery(input.trim());
        setPage(1);
      },
      input ? 280 : 0,
    );
    return () => clearTimeout(h);
  }, [input]);

  // Fetch one page (reads ສິນຄ້າຄົງເຫຼືອ from ic_inventory).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = query ? `&q=${encodeURIComponent(query)}` : "";
        const res = await fetch(
          `/api/inventory/list?page=${page}&pageSize=${PAGE_SIZE}${qs}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          items: Item[];
          total: number;
          totalPages: number;
        };
        if (!cancelled) {
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(data.totalPages ?? 1);
          setError(null);
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, page]);

  const pageQty = useMemo(
    () => items.reduce((s, it) => s + (it.companyBalance || 0), 0),
    [items],
  );

  async function toggleRow(code: string) {
    if (expanded === code) {
      setExpanded(null);
      return;
    }
    setExpanded(code);
    if (locCache[code]) return;
    setLocCache((m) => ({ ...m, [code]: "loading" }));
    try {
      const res = await fetch(
        `/api/inventory/stock-locations?code=${encodeURIComponent(code)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { locations: StockLocation[] };
      setLocCache((m) => ({ ...m, [code]: data.locations ?? [] }));
    } catch {
      setLocCache((m) => ({ ...m, [code]: "error" }));
    }
  }

  const fromN = total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const toN = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Title */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <path d="M3.27 6.96 12 12.01l8.73-5.05" />
            <path d="M12 22.08V12" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight text-odoo-text-strong">
            ສິນຄ້າຄົງເຫຼືອ
          </h1>
          <p className="text-xs text-odoo-text-muted">
            ຍອດຄົງເຫຼືອຈາກ ic_inventory · ກົດແຖວເພື່ອເບິ່ງຍອດແຍກຕາມສາງ
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <KpiCard tone="bg-indigo-50 text-indigo-600" value={moneyFmt.format(total)} label="ລາຍການທັງໝົດ" icon={<path d="M3 7h18M3 12h18M3 17h18" />} />
        <KpiCard
          tone="bg-emerald-50 text-emerald-600"
          value={qtyFmt.format(pageQty)}
          label="ໜ່ວຍໃນໜ້ານີ້"
          icon={<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></>}
        />
        <KpiCard
          tone="bg-violet-50 text-violet-600"
          value={`${page}/${totalPages}`}
          label="ໜ້າປະຈຸບັນ"
          icon={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></>}
        />
      </div>

      {/* Search */}
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-odoo-text-muted">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ຄົ້ນ ລະຫັດ / ຊື່ / ຍີ່ຫໍ້ / ໝວດ"
          className="w-full rounded-2xl border border-odoo-border bg-white py-3 pl-11 pr-10 text-sm shadow-sm outline-none transition focus:border-odoo-primary focus:ring-4 focus:ring-odoo-primary/10"
        />
        {input ? (
          <button type="button" onClick={() => setInput("")} aria-label="ລ້າງ" className="absolute right-4 top-1/2 -translate-y-1/2 text-odoo-text-muted hover:text-odoo-danger">
            ✕
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="odoo-alert-danger mt-4 px-3 py-2 text-sm">{error}</div>
      ) : null}

      {/* Modern table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-odoo-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wide text-odoo-text-muted">
                <th className="px-4 py-3">ລະຫັດ</th>
                <th className="px-4 py-3">ສິນຄ້າ</th>
                <th className="px-4 py-3">ຍີ່ຫໍ້ / ໝວດ</th>
                <th className="px-4 py-3 text-center">ໜ່ວຍ</th>
                <th className="px-4 py-3 text-right">ຄົງເຫຼືອ</th>
                <th className="px-4 py-3 text-right">ລາຄາ (ກີບ)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={COLS} className="px-4 py-16 text-center text-odoo-text-muted">
                    <div className="text-5xl opacity-20">📦</div>
                    <div className="mt-2 text-sm font-semibold">ບໍ່ພົບສິນຄ້າ</div>
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <ProductRow
                    key={it.code}
                    item={it}
                    isOpen={expanded === it.code}
                    locs={locCache[it.code]}
                    onToggle={() => toggleRow(it.code)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pager */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-odoo-text-muted">
          {total > 0
            ? `${moneyFmt.format(fromN)}–${moneyFmt.format(toN)} ຈາກ ${moneyFmt.format(total)} ລາຍການ`
            : "—"}
        </div>
        <div className="flex items-center gap-1.5">
          <PagerButton disabled={page <= 1 || loading} onClick={() => setPage(1)} label="«" />
          <PagerButton disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))} label="‹" />
          <span className="mx-1 rounded-xl bg-odoo-surface-muted px-3 py-2 text-sm font-bold text-odoo-text-strong">
            {page} <span className="text-odoo-text-muted">/ {totalPages}</span>
          </span>
          <PagerButton disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} label="›" />
          <PagerButton disabled={page >= totalPages || loading} onClick={() => setPage(totalPages)} label="»" />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  tone,
  value,
  label,
  icon,
}: {
  tone: string;
  value: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-odoo-border bg-white px-4 py-3 shadow-sm">
      <span className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-xl " + tone}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <div className="min-w-0">
        <div className="truncate text-lg font-black leading-none text-odoo-text-strong">{value}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-odoo-text-muted">{label}</div>
      </div>
    </div>
  );
}

function PagerButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-odoo-border bg-white text-sm font-bold text-odoo-text-strong transition hover:border-odoo-primary hover:text-odoo-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-odoo-border disabled:hover:text-odoo-text-strong"
    >
      {label}
    </button>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-odoo-border/60">
      <td className="px-4 py-3.5"><div className="h-4 w-20 animate-pulse rounded bg-odoo-surface-muted" /></td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-odoo-surface-muted" />
          <div className="h-3.5 w-48 animate-pulse rounded bg-odoo-surface-muted" />
        </div>
      </td>
      <td className="px-4 py-3.5"><div className="h-3 w-16 animate-pulse rounded bg-odoo-surface-muted" /></td>
      <td className="px-4 py-3.5"><div className="mx-auto h-3 w-10 animate-pulse rounded bg-odoo-surface-muted" /></td>
      <td className="px-4 py-3.5"><div className="ml-auto h-6 w-16 animate-pulse rounded-full bg-odoo-surface-muted" /></td>
      <td className="px-4 py-3.5"><div className="ml-auto h-4 w-20 animate-pulse rounded bg-odoo-surface-muted" /></td>
    </tr>
  );
}

function ProductRow({
  item,
  isOpen,
  locs,
  onToggle,
}: {
  item: Item;
  isOpen: boolean;
  locs: StockLocation[] | "loading" | "error" | undefined;
  onToggle: () => void;
}) {
  const tone = stockTone(item.companyBalance);
  const name = item.nameLo ?? item.nameEng ?? item.code;
  return (
    <>
      <tr
        className={
          "cursor-pointer border-t border-odoo-border/60 transition " +
          (isOpen ? "bg-odoo-primary-50" : "hover:bg-odoo-surface-muted/60")
        }
        onClick={onToggle}
      >
        {/* Code */}
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={"text-odoo-text-muted transition-transform " + (isOpen ? "rotate-90" : "")}>▸</span>
            <span className="rounded-md bg-odoo-surface-muted px-1.5 py-0.5 font-mono text-[12px] font-semibold text-odoo-text-strong">
              {item.code}
            </span>
          </span>
        </td>
        {/* Product (avatar + name) */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " + avatarTone(item.code)}>
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <path d="M3.27 6.96 12 12.01l8.73-5.05" />
                <path d="M12 22.08V12" />
              </svg>
            </span>
            <span className="max-w-[28rem] truncate font-semibold text-odoo-text-strong">
              {name}
            </span>
          </div>
        </td>
        {/* Brand / category */}
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {item.brand ? (
              <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">{item.brand}</span>
            ) : null}
            {item.category ? (
              <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">{item.category}</span>
            ) : null}
            {!item.brand && !item.category ? <span className="text-xs text-odoo-text-muted">—</span> : null}
          </div>
        </td>
        {/* Unit */}
        <td className="px-4 py-3 text-center text-xs text-odoo-text-muted">{item.unitName ?? "—"}</td>
        {/* Stock */}
        <td className="px-4 py-3 text-right">
          <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 " + tone.bg + " " + tone.text + " " + tone.ring}>
            <span className={"h-1.5 w-1.5 rounded-full " + tone.dot} />
            {qtyFmt.format(item.companyBalance)}
          </span>
        </td>
        {/* Price */}
        <td className="px-4 py-3 text-right">
          {item.salePriceKip > 0 ? (
            <span className="font-mono font-black text-odoo-text-strong">{moneyFmt.format(item.salePriceKip)}</span>
          ) : (
            <span className="text-odoo-text-muted">—</span>
          )}
        </td>
      </tr>
      {isOpen ? (
        <tr className="bg-odoo-surface-muted/40">
          <td colSpan={COLS} className="px-4 py-3">
            {locs === "loading" || locs === undefined ? (
              <div className="flex items-center gap-2 text-xs text-odoo-text-muted">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-odoo-border border-t-odoo-primary" />
                ກຳລັງໂຫລດຍອດແຍກສາງ...
              </div>
            ) : locs === "error" ? (
              <div className="text-xs text-odoo-danger">ໂຫລດຍອດແຍກສາງບໍ່ສຳເລັດ</div>
            ) : locs.length === 0 ? (
              <div className="text-xs text-odoo-text-muted">ບໍ່ມີສະຕັອກໃນສາງໃດ</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {locs.map((l, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-xl border border-odoo-border bg-white px-3 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9 12 4l9 5v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z" />
                        <path d="M9 22V12h6v10" />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-odoo-text-strong">{l.warehouseName ?? l.warehouse ?? "—"}</div>
                      <div className="text-[10px] text-odoo-text-muted">{l.locationName ?? l.location ?? "—"}</div>
                    </div>
                    <span className="ml-auto font-mono text-sm font-bold text-emerald-600">{qtyFmt.format(l.balanceQty)}</span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
