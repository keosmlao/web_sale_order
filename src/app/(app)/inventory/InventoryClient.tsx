"use client";

import { useEffect, useRef, useState } from "react";

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

const PAGE_SIZE = 10;
const MIN_QUERY = 2;

// Colour-code on-hand qty so low stock pops at a glance.
function stockTone(qty: number): { dot: string; text: string; bg: string; ring: string } {
  if (qty <= 5)
    return { dot: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", ring: "ring-rose-200" };
  if (qty <= 20)
    return { dot: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200" };
  return { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200" };
}

export default function InventoryClient() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [locCache, setLocCache] = useState<Record<string, StockLocation[] | "loading" | "error">>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Search-first: nothing is fetched until the cashier types. Debounce the
  // box; queries shorter than MIN_QUERY clear the results entirely.
  useEffect(() => {
    const term = input.trim();
    const h = setTimeout(() => {
      setQuery(term.length >= MIN_QUERY ? term : "");
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [input]);

  useEffect(() => {
    if (!query) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        const res = await fetch(
          `/api/inventory/list?page=${page}&pageSize=${PAGE_SIZE}&q=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: Item[]; total: number };
        if (cancelled) return;
        setItems((prev) => (page === 1 ? data.items ?? [] : [...prev, ...(data.items ?? [])]));
        setTotal(data.total ?? 0);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, page]);

  async function toggleRow(code: string) {
    if (expanded === code) {
      setExpanded(null);
      return;
    }
    setExpanded(code);
    if (locCache[code]) return;
    setLocCache((m) => ({ ...m, [code]: "loading" }));
    try {
      const res = await fetch(`/api/inventory/stock-locations?code=${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { locations: StockLocation[] };
      setLocCache((m) => ({ ...m, [code]: data.locations ?? [] }));
    } catch {
      setLocCache((m) => ({ ...m, [code]: "error" }));
    }
  }

  const hasMore = items.length < total;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
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
          <h1 className="text-xl font-black tracking-tight text-odoo-text-strong">ສິນຄ້າຄົງເຫຼືອ</h1>
          <p className="text-xs text-odoo-text-muted">ພິມຄົ້ນຫາກ່ອນ — ຜົນອອກສະເພາະທີ່ຄົ້ນ, ໄວກວ່າ</p>
        </div>
      </div>

      {/* Search (hero) */}
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-odoo-text-muted">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ຄົ້ນ ລະຫັດ / ຊື່ / ຍີ່ຫໍ້ / ໝວດ / barcode"
          className="w-full rounded-2xl border-2 border-odoo-border bg-white py-3.5 pl-11 pr-10 text-[15px] font-semibold shadow-sm outline-none transition focus:border-odoo-primary focus:ring-4 focus:ring-odoo-primary/10"
        />
        {input ? (
          <button
            type="button"
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
            aria-label="ລ້າງ"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-odoo-text-muted hover:text-odoo-danger"
          >
            ✕
          </button>
        ) : null}
      </div>

      {error ? <div className="odoo-alert-danger mt-4 px-3 py-2 text-sm">{error}</div> : null}

      {/* Idle state — nothing was fetched */}
      {!query && !loading ? (
        <div className="mt-10 text-center text-odoo-text-muted">
          <div className="text-6xl opacity-20">🔍</div>
          <div className="mt-3 text-sm font-bold text-odoo-text-strong">ພິມຢ່າງໜ້ອຍ {MIN_QUERY} ຕົວອັກສອນ ເພື່ອຄົ້ນຫາສິນຄ້າ</div>
          <div className="mt-1 text-xs">ຕົວຢ່າງ: 110101 · HISENSE · ຕູ້ເຢັນ — ກົດຜົນເພື່ອເບິ່ງຍອດແຍກສາງ</div>
        </div>
      ) : null}

      {/* Result count */}
      {query && !loading ? (
        <div className="mt-4 text-xs font-semibold text-odoo-text-muted">
          ພົບ {moneyFmt.format(total)} ລາຍການ {total > items.length ? `· ສະແດງ ${items.length}` : ""}
        </div>
      ) : null}

      {/* Results — one compact card per item, phone-first */}
      <div className="mt-2 space-y-2">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-odoo-border bg-white p-3">
                <div className="h-10 w-14 animate-pulse rounded-lg bg-odoo-surface-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-odoo-surface-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-odoo-surface-muted" />
                </div>
                <div className="h-6 w-14 animate-pulse rounded-full bg-odoo-surface-muted" />
              </div>
            ))
          : items.map((it) => (
              <ItemCard
                key={it.code}
                item={it}
                isOpen={expanded === it.code}
                locs={locCache[it.code]}
                onToggle={() => toggleRow(it.code)}
              />
            ))}
        {query && !loading && items.length === 0 && !error ? (
          <div className="rounded-2xl border border-odoo-border bg-white px-4 py-12 text-center text-odoo-text-muted">
            <div className="text-5xl opacity-20">📦</div>
            <div className="mt-2 text-sm font-semibold">ບໍ່ພົບສິນຄ້າ “{query}”</div>
          </div>
        ) : null}
      </div>

      {/* Load more */}
      {query && !loading && hasMore ? (
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={loadingMore}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-odoo-border bg-white py-3 text-sm font-black text-odoo-primary transition hover:bg-odoo-primary-50 disabled:opacity-50"
        >
          {loadingMore ? "ກຳລັງໂຫລດ…" : `ໂຫລດເພີ່ມ (ເຫຼືອ ${moneyFmt.format(total - items.length)})`}
        </button>
      ) : null}
    </div>
  );
}

function ItemCard({
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
    <div
      className={
        "overflow-hidden rounded-2xl border bg-white transition " +
        (isOpen ? "border-odoo-primary shadow-md" : "border-odoo-border shadow-sm")
      }
    >
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-bold leading-snug text-odoo-text-strong">{name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-odoo-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-bold text-odoo-text-strong">
              {item.code}
            </span>
            {item.brand ? (
              <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">{item.brand}</span>
            ) : null}
            {item.category ? (
              <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">{item.category}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 " + tone.bg + " " + tone.text + " " + tone.ring}>
            <span className={"h-1.5 w-1.5 rounded-full " + tone.dot} />
            {qtyFmt.format(item.companyBalance)}
            {item.unitName ? <span className="font-semibold opacity-70">{item.unitName}</span> : null}
          </span>
          {item.salePriceKip > 0 ? (
            <span className="font-mono text-[13px] font-black text-odoo-text-strong">{moneyFmt.format(item.salePriceKip)}</span>
          ) : null}
          <span className={"text-[10px] text-odoo-text-muted transition-transform " + (isOpen ? "rotate-180" : "")}>▾ ສາງ</span>
        </div>
      </button>
      {isOpen ? (
        <div className="border-t border-odoo-border/60 bg-odoo-surface-muted/40 px-3 py-2.5">
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
            <div className="grid gap-1.5 sm:grid-cols-2">
              {locs.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-odoo-border bg-white px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-odoo-text-strong">{l.warehouseName ?? l.warehouse ?? "—"}</div>
                    <div className="truncate text-[10px] text-odoo-text-muted">{l.locationName ?? l.location ?? "—"}</div>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-bold text-emerald-600">{qtyFmt.format(l.balanceQty)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
