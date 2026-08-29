"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtDate } from "@/lib/datetime";

// ສາງສິນຄ້າ / ສະຕັອກ — the whole catalog, filterable by group, category
// and brand, with ໝົດ read as a state rather than a vanished item, and a
// slide-over drawer per item: price, live balance per warehouse, the
// catalog facts, the KIP price table, the barcodes. Modelled on the
// owner's reference screen.

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

type Facets = {
  groups: Array<{ code: string; name: string }>;
  subs: Array<{ code: string; name: string }>;
  subs2: Array<{ code: string; name: string }>;
  categories: Array<{ code: string; name: string }>;
  brands: string[];
};

type ItemDetail = {
  code: string;
  nameLo: string | null;
  nameEng: string | null;
  unitName: string | null;
  brand: string | null;
  companyBalance: number;
  groupMain: string | null;
  groupSub: string | null;
  groupSub2: string | null;
  category: string | null;
  pattern: string | null;
  warehouses: Array<{ code: string; name: string; qty: number }>;
  prices: Array<{
    unit: string | null;
    fromQty: number;
    toQty: number;
    fromDate: string | null;
    toDate: string | null;
    priceKip: number;
  }>;
  barcodes: Array<{ barcode: string | null; unit: string | null }>;
};

const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
// First screen loads 20; scrolling the bottom into view fetches 10 more.
const FIRST_PAGE = 20;
const NEXT_PAGE = 10;

function StockBadge({ qty }: { qty: number }) {
  if (qty <= 0) {
    return (
      <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-600">
        ໝົດ
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-[12px] font-bold text-emerald-700">
      {qtyFmt.format(qty)}
    </span>
  );
}

export default function InventoryClient() {
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<Facets | null>(null);
  const [groupMain, setGroupMain] = useState("");
  const [groupSub, setGroupSub] = useState("");
  const [groupSub2, setGroupSub2] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [stock, setStock] = useState<"all" | "in" | "out">("all");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [openCode, setOpenCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<ItemDetail | "loading" | "error" | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/inventory/facets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setFacets(d))
      .catch(() => setFacets(null));
  }, []);

  // offset-addressed fetch: offset 0 pulls the first 20 (a fresh list);
  // any other offset pulls 10 and appends. The API pages by
  // (page, pageSize), so the offset maps onto exact page boundaries.
  const fetchList = useCallback(
    async (offset: number) => {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const pageSize = offset === 0 ? FIRST_PAGE : NEXT_PAGE;
        const page = offset === 0 ? 1 : offset / NEXT_PAGE + 1;
        const p = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          stock,
        });
        if (q.trim()) p.set("q", q.trim());
        if (groupMain) p.set("groupMain", groupMain);
        if (groupSub) p.set("groupSub", groupSub);
        if (groupSub2) p.set("groupSub2", groupSub2);
        if (category) p.set("category", category);
        if (brand) p.set("brand", brand);
        const res = await fetch(`/api/inventory/list?${p}`);
        if (!res.ok) {
          setError(`Error ${res.status}`);
          return;
        }
        const data = await res.json();
        const fresh: Item[] = data.items ?? [];
        setItems((prev) => (offset === 0 ? fresh : [...prev, ...fresh]));
        setTotal(data.total ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "fetch failed");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [q, stock, groupMain, groupSub, groupSub2, category, brand],
  );

  // Any filter change restarts the list from the top.
  useEffect(() => {
    const t = setTimeout(() => void fetchList(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchList, q]);

  // The bottom sentinel pulls the next 10 as it scrolls into view.
  const hasMore = items.length < total;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
          // 20 first, then 10 at a time — offsets stay on NEXT_PAGE
          // boundaries after the first pull (20 = 2 × 10).
          void fetchList(items.length);
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fetchList, hasMore, loading, loadingMore, items.length]);

  useEffect(() => {
    if (!openCode) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail("loading");
    fetch(`/api/inventory/item/${encodeURIComponent(openCode)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail("error");
      });
    return () => {
      cancelled = true;
    };
  }, [openCode]);

  const selectCls = "odoo-input w-full text-sm sm:!w-auto sm:min-w-36";

  return (
    <div className="px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-xl font-black text-odoo-text-strong">
          📦 ສາງສິນຄ້າ / ສະຕັອກ
        </h1>
        <p className="mt-0.5 text-[12.5px] text-odoo-text-muted">
          ຍອດຄົງເຫຼືອຈາກ ERP (ic_inventory) · ພົບ {moneyFmt.format(total)} ລາຍການ
        </p>
      </header>

      <div className="mb-4 rounded-xl border border-odoo-border bg-odoo-surface p-3">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ຄົ້ນຫາ ຊື່ / ລະຫັດສິນຄ້າ"
            className="odoo-input col-span-2 w-full sm:w-64"
          />
          <select value={groupMain} onChange={(e) => setGroupMain(e.target.value)} className={selectCls}>
            <option value="">ທຸກກຸ່ມຫຼັກ</option>
            {(facets?.groups ?? []).map((g) => (
              <option key={g.code} value={g.code}>{g.name}</option>
            ))}
          </select>
          <select value={groupSub} onChange={(e) => setGroupSub(e.target.value)} className={selectCls}>
            <option value="">ທຸກກຸ່ມຍ່ອຍ 1</option>
            {(facets?.subs ?? []).map((g) => (
              <option key={g.code} value={g.code}>{g.name}</option>
            ))}
          </select>
          <select value={groupSub2} onChange={(e) => setGroupSub2(e.target.value)} className={selectCls}>
            <option value="">ທຸກກຸ່ມຍ່ອຍ 2</option>
            {(facets?.subs2 ?? []).map((g) => (
              <option key={g.code} value={g.code}>{g.name}</option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
            <option value="">ທຸກໝວດໝູ່</option>
            {(facets?.categories ?? []).map((g) => (
              <option key={g.code} value={g.code}>{g.name}</option>
            ))}
          </select>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectCls}>
            <option value="">ທຸກຍີ່ຫໍ້</option>
            {(facets?.brands ?? []).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(
            [
              ["all", "ທັງໝົດ"],
              ["in", "ມີສະຕັອກ"],
              ["out", "ໝົດ"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStock(value)}
              className={
                "rounded-full px-3.5 py-1.5 text-xs font-bold transition " +
                (stock === value
                  ? "bg-odoo-primary text-white"
                  : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">
          {error}
        </p>
      ) : null}

      {/* On a phone the table clipped both edges — name cut left, price and
          stock off the right. Below sm each item is a card: image, name,
          the stock badge and the price all inside the screen. */}
      <div className="sm:hidden">
        {loading ? (
          <p className="py-10 text-center text-sm text-odoo-text-muted">ກຳລັງໂຫລດ…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-odoo-text-muted">ບໍ່ພົບສິນຄ້າ</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.code}>
                <button
                  type="button"
                  onClick={() => setOpenCode(it.code)}
                  className="flex w-full items-center gap-3 rounded-xl border border-odoo-border bg-odoo-surface p-3 text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/products/image/${encodeURIComponent(it.code)}`}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg border border-odoo-border object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-odoo-text-strong">
                      {it.nameLo ?? it.nameEng ?? it.code}
                    </span>
                    <span className="block font-mono text-[11px] text-odoo-text-muted">
                      {it.code}
                      {it.brand ? ` · ${it.brand}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <StockBadge qty={it.companyBalance} />
                    <span className="mt-0.5 block font-mono text-[13px] font-bold">
                      {it.salePriceKip > 0 ? moneyFmt.format(it.salePriceKip) : "—"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-odoo-border bg-odoo-surface sm:block">
        <table className="w-full text-sm">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">ສິນຄ້າ</th>
              <th className="px-3 py-2">ຍີ່ຫໍ້</th>
              <th className="px-3 py-2">ໜ່ວຍ</th>
              <th className="px-3 py-2 text-center">ຄົງເຫຼືອ</th>
              <th className="px-3 py-2 text-right">ລາຄາ</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-odoo-text-muted">
                  ກຳລັງໂຫລດ…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-odoo-text-muted">
                  ບໍ່ພົບສິນຄ້າ
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr
                  key={it.code}
                  onClick={() => setOpenCode(it.code)}
                  className="cursor-pointer border-t border-odoo-border hover:bg-odoo-surface-muted/50"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/products/image/${encodeURIComponent(it.code)}`}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg border border-odoo-border object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-odoo-text-strong">
                          {it.nameLo ?? it.nameEng ?? it.code}
                        </div>
                        <div className="font-mono text-[11px] text-odoo-text-muted">
                          {it.code}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px] font-semibold text-odoo-text-muted">
                    {it.brand ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-odoo-text-muted">
                    {it.unitName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <StockBadge qty={it.companyBalance} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {it.salePriceKip > 0 ? moneyFmt.format(it.salePriceKip) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[12px] font-bold text-odoo-primary">
                    ລາຍລະອຽດ →
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div ref={sentinelRef} className="py-3 text-center text-[12px] text-odoo-text-muted">
        {loadingMore
          ? "ກຳລັງໂຫລດເພີ່ມ…"
          : hasMore
            ? `ເລື່ອນລົງເພື່ອໂຫລດເພີ່ມ (${moneyFmt.format(items.length)} / ${moneyFmt.format(total)})`
            : items.length > 0
              ? `ຄົບແລ້ວ ${moneyFmt.format(total)} ລາຍການ`
              : ""}
      </div>

      {/* ── Detail drawer ── */}
      {openCode ? (
        <div className="fixed inset-0 z-[70]">
          <button
            type="button"
            aria-label="ປິດ"
            onClick={() => setOpenCode(null)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-odoo-surface shadow-2xl">
            {detail === "loading" || detail === null ? (
              <p className="p-8 text-center text-sm text-odoo-text-muted">ກຳລັງໂຫລດ…</p>
            ) : detail === "error" ? (
              <p className="p-8 text-center text-sm text-odoo-danger">ໂຫລດບໍ່ສຳເລັດ</p>
            ) : (
              <>
                <div className="bg-gradient-to-br from-[#003361] to-[#2b70b5] p-4 text-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/products/image/${encodeURIComponent(detail.code)}`}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                      <div className="min-w-0">
                        <h2 className="text-[15px] font-black leading-snug">
                          {detail.nameLo ?? detail.nameEng ?? detail.code}
                        </h2>
                        <div className="font-mono text-[12px] text-white/70">
                          {detail.code}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {[detail.brand, detail.groupMain, detail.category]
                            .filter(Boolean)
                            .map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-bold"
                              >
                                {t}
                              </span>
                            ))}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenCode(null)}
                      className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 font-bold hover:bg-white/25"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 p-4">
                  <div className="rounded-xl bg-gradient-to-br from-[#2b70b5] to-[#4ac7f0] p-3.5 text-white">
                    <div className="text-[11px] font-bold text-white/75">ລາຄາຂາຍ</div>
                    <div className="font-mono text-2xl font-black">
                      {detail.prices[0]?.priceKip
                        ? moneyFmt.format(detail.prices[0].priceKip)
                        : "—"}{" "}
                      <small className="text-[12px] font-bold">ກີບ</small>
                    </div>
                  </div>
                  <div className="rounded-xl border border-odoo-border p-3.5">
                    <div className="text-[11px] font-bold text-odoo-text-muted">
                      ຄົງເຫຼືອ (IC_INVENTORY)
                    </div>
                    <div
                      className={`text-2xl font-black ${detail.companyBalance > 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {detail.companyBalance > 0
                        ? `${qtyFmt.format(detail.companyBalance)} ${detail.unitName ?? ""}`
                        : "ໝົດສາງ"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 px-4 pb-6">
                  <section className="rounded-xl border border-odoo-border">
                    <h3 className="border-b border-odoo-border px-3.5 py-2.5 text-[13px] font-black">
                      ຄົງເຫຼືອຕາມສາງ{" "}
                      <span className="ml-1 rounded-full bg-odoo-surface-muted px-2 text-[11px] text-odoo-text-muted">
                        {detail.warehouses.length}
                      </span>
                    </h3>
                    {detail.warehouses.length === 0 ? (
                      <p className="px-3.5 py-5 text-center text-[12.5px] text-odoo-text-muted">
                        ບໍ່ມີການເຄື່ອນໄຫວໃນສາງ
                      </p>
                    ) : (
                      <ul className="divide-y divide-odoo-border">
                        {detail.warehouses.map((w) => (
                          <li
                            key={w.code}
                            className="flex items-baseline justify-between px-3.5 py-2 text-sm"
                          >
                            <span>
                              <b className="font-mono text-[12px]">{w.code}</b>{" "}
                              <span className="text-odoo-text-muted">{w.name}</span>
                            </span>
                            <b className="font-mono">{qtyFmt.format(w.qty)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="rounded-xl border border-odoo-border">
                    <h3 className="border-b border-odoo-border px-3.5 py-2.5 text-[13px] font-black">
                      ຂໍ້ມູນສິນຄ້າ
                    </h3>
                    <dl className="grid grid-cols-1 gap-x-6 px-3.5 py-2 text-sm sm:grid-cols-2">
                      {(
                        [
                          ["ກຸ່ມຫຼັກ", detail.groupMain],
                          ["ກຸ່ມຍ່ອຍ", detail.groupSub],
                          ["ກຸ່ມຍ່ອຍ 2", detail.groupSub2],
                          ["ໝວດ", detail.category],
                          ["ຮູບແບບ", detail.pattern],
                          ["ໜ່ວຍ", detail.unitName],
                          ["ຍີ່ຫໍ້", detail.brand],
                        ] as const
                      )
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <div
                            key={k}
                            className="flex items-baseline justify-between gap-3 border-b border-odoo-border/60 py-1.5 last:border-0"
                          >
                            <dt className="text-[12px] font-bold text-odoo-text-muted">{k}</dt>
                            <dd className="text-right font-semibold">{v}</dd>
                          </div>
                        ))}
                    </dl>
                  </section>

                  <section className="rounded-xl border border-odoo-border">
                    <h3 className="border-b border-odoo-border px-3.5 py-2.5 text-[13px] font-black">
                      ຕາຕະລາງລາຄາ{" "}
                      <span className="ml-1 rounded-full bg-amber-100 px-2 text-[11px] text-amber-700">
                        {detail.prices.length}
                      </span>
                    </h3>
                    {detail.prices.length === 0 ? (
                      <p className="px-3.5 py-5 text-center text-[12.5px] text-odoo-text-muted">
                        ບໍ່ມີລາຄາ
                      </p>
                    ) : (
                      <ul className="divide-y divide-odoo-border">
                        {detail.prices.map((p, i) => {
                          // Say WHY a row exists: the qty tier when it is
                          // a real tier, and the full validity window —
                          // two prices must never look identical.
                          const tier =
                            p.fromQty > 1 || (p.toQty > 0 && p.toQty < 9999)
                              ? `${qtyFmt.format(p.fromQty)}–${qtyFmt.format(p.toQty)} ${p.unit ?? ""}`
                              : (p.unit ?? "—");
                          return (
                            <li
                              key={i}
                              className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-sm"
                            >
                              <span className="text-[12px] text-odoo-text-muted">
                                <b className="text-odoo-text">{tier}</b>
                                {p.fromDate || p.toDate
                                  ? ` · ${p.fromDate ? fmtDate(p.fromDate) : "…"} → ${p.toDate ? fmtDate(p.toDate) : "…"}`
                                  : ""}
                              </span>
                              <b className="shrink-0 font-mono">
                                {moneyFmt.format(p.priceKip)} ກີບ
                              </b>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section className="rounded-xl border border-odoo-border">
                    <h3 className="border-b border-odoo-border px-3.5 py-2.5 text-[13px] font-black">
                      ບາໂຄດ{" "}
                      <span className="ml-1 rounded-full bg-odoo-surface-muted px-2 text-[11px] text-odoo-text-muted">
                        {detail.barcodes.length}
                      </span>
                    </h3>
                    {detail.barcodes.length === 0 ? (
                      <p className="px-3.5 py-5 text-center text-[12.5px] text-odoo-text-muted">
                        ບໍ່ມີບາໂຄດ
                      </p>
                    ) : (
                      <ul className="divide-y divide-odoo-border">
                        {detail.barcodes.map((b, i) => (
                          <li
                            key={i}
                            className="flex items-baseline justify-between px-3.5 py-2 text-sm"
                          >
                            <span className="font-mono">{b.barcode}</span>
                            <span className="text-[12px] text-odoo-text-muted">
                              {b.unit ?? ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
