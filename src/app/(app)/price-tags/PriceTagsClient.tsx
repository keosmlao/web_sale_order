"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PriceTag, {
  discountPercent,
  isASheetSize,
  TAG_SIZES,
  type PriceTagData,
  type TagSize,
} from "./PriceTag";

type SearchItem = {
  code: string;
  name: string;
  nameEng: string | null;
  unit: string | null;
  unitName: string | null;
  salePriceKip: number;
};

type Promotion = {
  id: string;
  name: string;
  promoType: "bogo" | "item_pair_price" | "fixed_price_period";
  startAt: string | null;
  endAt: string | null;
  triggerItemCode: string | null;
  bonusItemCode: string | null;
  bonusQty: number | null;
  bonusPriceKip: number | null;
  fixedPriceKip: number | null;
  note: string | null;
};

const DEFAULT_CONTACT = "@odgplus · 020 5992 9992";
const DEFAULT_QR = "@odgplus";
const DEFAULT_RIBBON = "Super Sale";
const PX_PER_MM = 96 / 25.4;

// Printer paper presets (portrait dimensions, mm). The print sheet is chosen
// independently of the per-tag size — tags tile onto whatever paper is picked.
const PAPER_SIZES: Record<string, { label: string; w: number; h: number }> = {
  A3: { label: "A3", w: 297, h: 420 },
  A4: { label: "A4", w: 210, h: 297 },
  A5: { label: "A5", w: 148, h: 210 },
  A6: { label: "A6", w: 105, h: 148 },
  Letter: { label: "Letter", w: 216, h: 279 },
};
type PaperOrientation = "portrait" | "landscape";
function paperDimsMm(size: string, orientation: PaperOrientation) {
  const p = PAPER_SIZES[size] ?? PAPER_SIZES.A4;
  return orientation === "landscape" ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

// "01-30/06/2026" when both dates share a month/year, otherwise a full range.
function formatValidRange(fromISO: string | null, toISO: string | null): string {
  const from = fromISO ? new Date(fromISO) : null;
  const to = toISO ? new Date(toISO) : null;
  const fmt = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (from && to) {
    if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
      return `${pad2(from.getDate())}-${pad2(to.getDate())}/${pad2(to.getMonth() + 1)}/${to.getFullYear()}`;
    }
    return `${fmt(from)} - ${fmt(to)}`;
  }
  if (to) return `ຮອດ ${fmt(to)}`;
  if (from) return `ແຕ່ ${fmt(from)}`;
  return "";
}

let tagSeq = 0;

function FitPriceTag({ data, size }: { data: PriceTagData; size: TagSize }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  const dim = TAG_SIZES[size] ?? TAG_SIZES.large;
  const naturalW = dim.widthMm * PX_PER_MM;
  const naturalH = dim.heightMm * PX_PER_MM;
  const displayW = wrapWidth > 0 ? wrapWidth : naturalW;
  const scale = displayW / naturalW;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const updateWidth = () => setWrapWidth(el.clientWidth);
    updateWidth();
    const ro = new ResizeObserver(([entry]) => {
      setWrapWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="pt-fit-wrap">
      <div
        className="pt-fit-box"
        style={{ width: `${displayW}px`, height: `${naturalH * scale}px` }}
      >
        <div
          className="pt-fit-scale"
          style={{
            width: `${naturalW}px`,
            height: `${naturalH}px`,
            transform: `scale(${scale})`,
          }}
        >
          <PriceTag data={data} size={size} />
        </div>
      </div>
    </div>
  );
}

export default function PriceTagsClient() {
  // ---- product search + multi-select ----
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, SearchItem>>(new Map());

  // ---- active promotions (loaded once, indexed by trigger item) ----
  const [promos, setPromos] = useState<Promotion[]>([]);
  const promoByTrigger = useMemo(() => {
    const m = new Map<string, Promotion>();
    for (const p of promos) {
      if (p.triggerItemCode) m.set(p.triggerItemCode.trim(), p);
    }
    return m;
  }, [promos]);

  // ---- current editable draft ----
  const [draft, setDraft] = useState<PriceTagData | null>(null);

  // ---- batch + shared config ----
  const [batch, setBatch] = useState<PriceTagData[]>([]);
  const [ribbonText, setRibbonText] = useState(DEFAULT_RIBBON);
  const [contact, setContact] = useState(DEFAULT_CONTACT);
  const [qrText, setQrText] = useState(DEFAULT_QR);
  const [toggles, setToggles] = useState({
    showBarcode: true,
    showQr: true,
    showRibbon: true,
    showLogo: true,
  });

  // ---- tag size (one layout, scaled) ----
  const [tagSize, setTagSize] = useState<TagSize>("large");

  // ---- printer paper (independent of tag size) ----
  const [paperSize, setPaperSize] = useState("A4");
  const [orientation, setOrientation] = useState<PaperOrientation>("portrait");

  // ---- product source mode: pick individual items, or load from a warehouse ----
  const [pickMode, setPickMode] = useState<"product" | "warehouse">("product");

  // ---- load-from-warehouse picker ----
  const [warehouses, setWarehouses] = useState<{ code: string; name: string }[]>([]);
  const [whCode, setWhCode] = useState("");
  const [whResults, setWhResults] = useState<SearchItem[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [whLoaded, setWhLoaded] = useState(false);
  const [whError, setWhError] = useState<string | null>(null);

  // ---- print ----
  const [printList, setPrintList] = useState<PriceTagData[] | null>(null);

  useEffect(() => {
    void fetch("/api/promotions?active=1")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPromos(Array.isArray(data) ? data : []))
      .catch(() => setPromos([]));
  }, []);

  // Warehouse list for the "load from warehouse" picker.
  useEffect(() => {
    void fetch("/api/warehouses")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const items = Array.isArray(d?.items) ? d.items : [];
        setWarehouses(items);
        if (items.length > 0) setWhCode((cur) => cur || items[0].code);
      })
      .catch(() => setWarehouses([]));
  }, []);

  // Fetch the in-stock products for the chosen warehouse.
  async function loadWarehouseStock() {
    if (!whCode) return;
    setWhLoading(true);
    setWhLoaded(false);
    setWhError(null);
    try {
      const url = `/api/inventory/by-warehouse?warehouse=${encodeURIComponent(whCode)}`;
      const res = await fetch(url);
      if (!res.ok) {
        // Surface the failure instead of silently showing an empty panel —
        // otherwise a 500/timeout looks identical to "warehouse has no stock".
        setWhResults([]);
        setWhError(
          res.status === 504 || res.status === 500
            ? "ໂຫລດบໍ່ສຳເລັດ — server ໃຊ້ເວລານານເກີນ (timeout). ລອງໃໝ່ອີກຄັ້ງ."
            : `ໂຫລດบໍ່ສຳເລັດ (${res.status})`,
        );
        setWhLoaded(true);
        return;
      }
      const data = await res.json();
      const items: SearchItem[] = (Array.isArray(data?.items) ? data.items : []).map(
        (it: {
          code: string;
          nameLo: string | null;
          nameEng: string | null;
          unitName: string | null;
          salePriceKip: number | null;
        }) => ({
          code: it.code,
          name: it.nameLo ?? it.code,
          nameEng: it.nameEng ?? null,
          unit: null,
          unitName: it.unitName ?? null,
          salePriceKip: Number(it.salePriceKip ?? 0),
        }),
      );
      setWhResults(items);
      setWhLoaded(true);
    } catch {
      setWhResults([]);
      setWhError("ໂຫລດบໍ່ສຳເລັດ — ກວດການເชື່ອມຕໍ່ແລ້ວລອງໃໝ່.");
      setWhLoaded(true);
    } finally {
      setWhLoading(false);
    }
  }

  // Tick / untick every loaded warehouse item at once.
  function toggleSelectAllWarehouse() {
    setSelected((cur) => {
      const next = new Map(cur);
      const allIn = whResults.every((it) => next.has(it.code));
      if (allIn) {
        for (const it of whResults) next.delete(it.code);
      } else {
        for (const it of whResults) next.set(it.code, it);
      }
      return next;
    });
  }

  // Debounced product search.
  useEffect(() => {
    if (!searchOpen) return;
    const term = query.trim();
    let abort = false;
    const id = window.setTimeout(async () => {
      try {
        const url = `/api/inventory/search?sets=1${term ? `&q=${encodeURIComponent(term)}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as SearchItem[];
        if (!abort) setResults(Array.isArray(data) ? data.slice(0, 30) : []);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => {
      abort = true;
      window.clearTimeout(id);
    };
  }, [query, searchOpen]);

  // Fire the print dialog once the hidden print grid has the right tags.
  useEffect(() => {
    if (!printList || printList.length === 0) return;
    const id = window.setTimeout(() => {
      window.print();
      setPrintList(null);
    }, 80);
    return () => window.clearTimeout(id);
  }, [printList]);

  // Patch a tag wherever it lives (current draft and/or the batch).
  function patchTag(id: string, patch: Partial<PriceTagData>) {
    setDraft((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
    setBatch((b) => b.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // Build a tag from a product + its active promotion. Only per-product data
  // is stored here; shared design fields (ribbon/contact/qr/toggles) are
  // layered on at render time via withConfig().
  function buildTag(item: SearchItem, id: string): PriceTagData {
    const unit = item.unit || item.unitName || "ອັນ";
    const tag: PriceTagData = {
      id,
      productName: item.name,
      productCode: item.code,
      unit,
      oldPrice: null,
      newPrice: item.salePriceKip,
      promoText: "",
      ribbonText,
      validText: "",
      qrText,
      contact,
      ...toggles,
    };

    const promo = promoByTrigger.get(item.code.trim());
    if (promo) {
      tag.validText = formatValidRange(promo.startAt, promo.endAt);
      if (promo.promoType === "fixed_price_period" && promo.fixedPriceKip != null) {
        tag.newPrice = promo.fixedPriceKip;
        tag.oldPrice = item.salePriceKip > promo.fixedPriceKip ? item.salePriceKip : null;
      }
      if (promo.note) {
        tag.promoText = promo.note;
      } else if (promo.bonusItemCode) {
        const qtyText = promo.bonusQty ? ` x${promo.bonusQty}` : "";
        tag.promoText = `ແຖມຟຣີ ${promo.bonusItemCode}${qtyText}`;
        // Resolve the bonus item's real name in the background and patch.
        void fetch(`/api/inventory/barcode?code=${encodeURIComponent(promo.bonusItemCode)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.found && d.item?.name) {
              patchTag(id, { promoText: `ແຖມຟຣີ ${d.item.name}${qtyText}` });
            }
          })
          .catch(() => {});
      }
    }
    return tag;
  }

  // ---- selection helpers ----
  function toggleSelect(item: SearchItem) {
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(item.code)) next.delete(item.code);
      else next.set(item.code, item);
      return next;
    });
  }

  function loadIntoEditor(item: SearchItem) {
    setDraft(buildTag(item, `draft-${++tagSeq}`));
  }

  // Add every selected product to the print batch at once.
  function addSelectedToBatch() {
    if (selected.size === 0) return;
    const tags = Array.from(selected.values()).map((it) => buildTag(it, `tag-${++tagSeq}`));
    setBatch((b) => [...b, ...tags]);
    setSelected(new Map());
    setSearchOpen(false);
  }

  function patchDraft(patch: Partial<PriceTagData>) {
    setDraft((cur) => (cur ? { ...cur, ...patch } : cur));
  }

  function addDraftToBatch() {
    if (!draft) return;
    setBatch((b) => [...b, { ...draft, id: `tag-${++tagSeq}` }]);
  }

  function removeFromBatch(id: string) {
    setBatch((b) => b.filter((t) => t.id !== id));
  }

  // Layer the shared design config onto any tag so the controls apply to
  // every tag (preview, batch, print) — not just newly created ones.
  const withConfig = (t: PriceTagData): PriceTagData => ({
    ...t,
    ribbonText,
    contact,
    qrText,
    ...toggles,
  });

  const liveDraft = draft ? withConfig(draft) : null;
  const printPaper = paperDimsMm(paperSize, orientation);

  return (
    <div className="pt-modern min-h-screen px-3 py-4 sm:px-6 sm:py-6">
      <div className="pt-screen-only mx-auto max-w-7xl">
        <header className="pt-hero mb-5 overflow-hidden rounded-[22px] border border-cyan-200/30 bg-slate-950 px-5 py-5 text-white shadow-[0_20px_55px_rgba(15,23,42,0.18)] sm:px-6">
          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center rounded-full border border-cyan-300/35 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
                Price Tag Studio
              </div>
              <h1 className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl">
                ປ້າຍລາຄາສິນຄ້າ
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-300">
                ສ້າງ ແລະ ພິມປ້າຍລາຄາແບບທັນສະໄໝ — ເລືອກຈາກ search ຫຼື ສາງ, ດຶງໂປຣໂມຊັນ, ກຳນົດຂະໜາດ ແລະ ພິມໄດ້ທັນທີ.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur">
                <div className="text-2xl font-black text-cyan-100">{selected.size}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Selected
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur">
                <div className="text-2xl font-black text-cyan-100">{batch.length}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Batch
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur">
                <div className="text-2xl font-black text-cyan-100">{printPaper.w}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                  Paper mm
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(460px,520px)]">
          {/* ---- Left: controls ---- */}
          <div className="min-w-0 space-y-4">
            {/* Source mode: pick individual products, or load a warehouse's stock */}
            <div className="pt-segment inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
              {(
                [
                  ["product", "ຈາກສິນຄ້າ"],
                  ["warehouse", "ຈາກສາງ"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPickMode(m)}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                    pickMode === m
                      ? "bg-slate-950 text-cyan-100 shadow-[0_10px_24px_rgba(15,23,42,0.18)]"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {pickMode === "product" ? (
              <>
            {/* Product picker (multi-select) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-[15px] font-black text-slate-900">ເລືອກສິນຄ້າ</div>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    onClick={addSelectedToBatch}
                    className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-cyan-100 shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
                  >
                    + ເພີ່ມ {selected.size} ລາຍການໃສ່ຊຸດພິມ
                  </button>
                ) : null}
              </div>

              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="ຄົ້ນດ້ວຍລະຫັດ ຫຼື ຊື່ສິນຄ້າ"
                className="odoo-input mt-3 w-full"
                autoComplete="off"
              />

              {/* Selected chips */}
              {selected.size > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Array.from(selected.values()).map((it) => (
                    <span
                      key={it.code}
                      className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800"
                    >
                      {it.name}
                      <button
                        type="button"
                        onClick={() => toggleSelect(it)}
                        className="ml-0.5 text-cyan-500 hover:text-cyan-800"
                        title="ເອົາອອກ"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Results checklist */}
              {searchOpen && results.length > 0 ? (
                <div className="mt-3 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-1">
                  {results.map((r) => {
                    const checked = selected.has(r.code);
                    const hasPromo = promoByTrigger.has(r.code.trim());
                    return (
                      <div
                        key={r.code}
                        className={`flex items-center gap-2 border-b border-odoo-border px-3 py-2 text-sm last:border-b-0 ${
                          checked
                            ? "rounded-xl border border-cyan-200 bg-cyan-50"
                            : "rounded-xl border border-transparent hover:bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(r)}
                          className="h-4 w-4 shrink-0"
                        />
                        <button
                          type="button"
                          onClick={() => toggleSelect(r)}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="font-mono text-[11px] text-odoo-text-muted">{r.code}</span>
                            <span className="ml-2 text-odoo-text-strong">{r.name}</span>
                            {hasPromo ? (
                              <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                                ໂປຣ
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-odoo-text-muted">
                            {r.salePriceKip.toLocaleString()}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => loadIntoEditor(r)}
                          title="ແກ້ໄຂລະອຽດ"
                          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:border-cyan-300 hover:text-cyan-700"
                        >
                          ແກ້ໄຂ
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

              </>
            ) : null}

            {pickMode === "warehouse" ? (
              <>
            {/* Load from warehouse (in-stock products) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-odoo-text-strong">
                  ໂຫລດສິນຄ້າຄົງເຫຼືອຈາກສາງ
                </div>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    onClick={addSelectedToBatch}
                    className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-cyan-100 shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
                  >
                    + ເພີ່ມ {selected.size} ໃສ່ຊຸດພິມ
                  </button>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="grid gap-1">
                  <span className="odoo-label">ສາງ</span>
                  <select
                    className="odoo-input"
                    value={whCode}
                    onChange={(e) => setWhCode(e.target.value)}
                  >
                    {warehouses.length === 0 ? <option value="">—</option> : null}
                    {warehouses.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} · {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void loadWarehouseStock()}
                  disabled={!whCode || whLoading}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-cyan-100 shadow-[0_10px_24px_rgba(15,23,42,0.16)] transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {whLoading ? "ກຳລັງໂຫລດ…" : "ໂຫລດ"}
                </button>
              </div>

              {whLoaded ? (
                whResults.length > 0 ? (
                  <>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-odoo-text-muted">
                        ພົບ {whResults.length} ລາຍການ (ຄົງເຫຼືອ &gt; 0)
                      </div>
                      <button
                        type="button"
                        onClick={toggleSelectAllWarehouse}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-cyan-300 hover:text-cyan-700"
                      >
                        {whResults.every((it) => selected.has(it.code))
                          ? "ຍົກເລີກທັງໝົດ"
                          : "ເລືອກທັງໝົດ"}
                      </button>
                    </div>
                    <div className="mt-2 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-1">
                      {whResults.map((r) => {
                        const checked = selected.has(r.code);
                        const hasPromo = promoByTrigger.has(r.code.trim());
                        return (
                          <label
                            key={r.code}
                            className={`flex cursor-pointer items-center gap-2 border-b border-odoo-border px-3 py-2 text-sm last:border-b-0 ${
                              checked
                                ? "rounded-xl border border-cyan-200 bg-cyan-50"
                                : "rounded-xl border border-transparent hover:bg-white"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(r)}
                              className="h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-mono text-[11px] text-odoo-text-muted">
                                {r.code}
                              </span>
                              <span className="ml-2 text-odoo-text-strong">{r.name}</span>
                              {hasPromo ? (
                                <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                                  ໂປຣ
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-odoo-text-muted">
                              {r.salePriceKip.toLocaleString()}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                ) : whError ? (
                  <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-600">
                    {whError}
                  </div>
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                    ບໍ່ພົບສິນຄ້າຄົງເຫຼືອໃນສາງນີ້
                  </div>
                )
              ) : null}
            </div>
              </>
            ) : null}

            {/* Editable fields (single fine-tune) */}
            {draft ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-[15px] font-black text-slate-900">ແກ້ໄຂປ້າຍ</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="odoo-label">ຊື່ສິນຄ້າ</span>
                    <input
                      className="odoo-input"
                      value={draft.productName}
                      onChange={(e) => patchDraft({ productName: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="odoo-label">ລະຫັດ / barcode</span>
                    <input
                      className="odoo-input font-mono"
                      value={draft.productCode}
                      onChange={(e) => patchDraft({ productCode: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="odoo-label">ຫົວໜ່ວຍ</span>
                    <input
                      className="odoo-input"
                      value={draft.unit}
                      onChange={(e) => patchDraft({ unit: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="odoo-label">ລາຄາເກົ່າ (ຂີດຖິ້ມ)</span>
                    <input
                      type="number"
                      className="odoo-input"
                      value={draft.oldPrice ?? ""}
                      onChange={(e) =>
                        patchDraft({ oldPrice: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="odoo-label">ລາຄາຂາຍ</span>
                    <input
                      type="number"
                      className="odoo-input"
                      value={draft.newPrice}
                      onChange={(e) => patchDraft({ newPrice: Number(e.target.value) })}
                    />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="odoo-label">ໂປຣໂມຊັນ / ຂອງແຖມ</span>
                    <input
                      className="odoo-input"
                      value={draft.promoText}
                      placeholder="ເຊັ່ນ: ແຖມຟຣີ ..."
                      onChange={(e) => patchDraft({ promoText: e.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <span className="odoo-label">ໄລຍະເວລາ</span>
                    <input
                      className="odoo-input"
                      value={draft.validText}
                      placeholder="01-30/06/2026"
                      onChange={(e) => patchDraft({ validText: e.target.value })}
                    />
                  </label>
                </div>

                {discountPercent(draft.oldPrice, draft.newPrice) != null ? (
                  <div className="mt-3 text-[12px] font-bold text-red-600">
                    ສ່ວນຫຼຸດ −{discountPercent(draft.oldPrice, draft.newPrice)}%
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={addDraftToBatch}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-cyan-100 shadow-[0_10px_24px_rgba(15,23,42,0.16)] transition hover:bg-slate-800"
                >
                  + ເພີ່ມໃສ່ຊຸດພິມ
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-sm text-slate-500 shadow-sm">
                ໝາຍຕິກສິນຄ້າເພື່ອເພີ່ມໃສ່ຊຸດພິມ ຫຼື ກົດ “ແກ້ໄຂ” ເພື່ອປັບລະອຽດປ້າຍດຽວ
              </div>
            )}

            {/* Shared design config */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[15px] font-black text-slate-900">ຮູບແບບ (ໃຊ້ກັບທຸກປ້າຍ)</div>

              {/* Tag size — one layout, scaled to the chosen physical size. */}
              <div className="mt-3">
                <span className="odoo-label">ຂະໜາດປ້າຍ</span>
                <div className="mt-1 inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  {Object.values(TAG_SIZES).map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setTagSize(s.key)}
                      className={`rounded px-3 py-1.5 text-sm font-bold transition ${
                        tagSize === s.key
                          ? "bg-slate-950 text-cyan-100 shadow-sm"
                          : "text-slate-600 hover:bg-white"
                      }`}
                    >
                      {s.label}{" "}
                      <span className="text-[10px] font-semibold opacity-70">
                        {s.widthMm}×{s.heightMm}mm
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Printer paper + orientation — the sheet tags are printed on. */}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="odoo-label">ເຈ້ຍທີ່ພິມ</span>
                  <select
                    className="odoo-input"
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value)}
                  >
                    {Object.entries(PAPER_SIZES).map(([key, p]) => (
                      <option key={key} value={key}>
                        {p.label} ({p.w}×{p.h}mm)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="odoo-label">ລວງເຈ້ຍ</span>
                  <select
                    className="odoo-input"
                    value={orientation}
                    onChange={(e) =>
                      setOrientation(e.target.value as PaperOrientation)
                    }
                  >
                    <option value="portrait">ຕັ້ງ (Portrait)</option>
                    <option value="landscape">ນອນ (Landscape)</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="odoo-label">ຂໍ້ຄວາມ ribbon</span>
                  <input className="odoo-input" value={ribbonText} onChange={(e) => setRibbonText(e.target.value)} />
                </label>
                <label className="grid gap-1">
                  <span className="odoo-label">QR (link / handle)</span>
                  <input className="odoo-input" value={qrText} onChange={(e) => setQrText(e.target.value)} />
                </label>
                <label className="grid gap-1 sm:col-span-2">
                  <span className="odoo-label">ຂໍ້ມູນຕິດຕໍ່</span>
                  <input className="odoo-input" value={contact} onChange={(e) => setContact(e.target.value)} />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {([
                  ["showRibbon", "Ribbon ສ່ວນຫຼຸດ"],
                  ["showBarcode", "Barcode"],
                  ["showQr", "QR code"],
                  ["showLogo", "ໂລໂກ້"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2 font-semibold text-odoo-text-strong">
                    <input
                      type="checkbox"
                      checked={toggles[key]}
                      onChange={(e) => setToggles((t) => ({ ...t, [key]: e.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Right: live preview ---- */}
          <div className="xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_18px_46px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-600">
                    Live Preview
                  </div>
                  <div className="mt-1 text-sm font-black text-slate-950">
                    ຕົວຢ່າງກ່ອນພິມ
                  </div>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold text-slate-500">
                  {TAG_SIZES[tagSize].widthMm}×{TAG_SIZES[tagSize].heightMm}mm
                </div>
              </div>
              <div className="pt-preview-stage mt-3 rounded-2xl border border-slate-800/80 bg-slate-950 p-4">
                {liveDraft ? (
                  <FitPriceTag data={liveDraft} size={tagSize} />
                ) : (
                  <div className="pt-empty-fit flex items-center justify-center rounded-2xl border border-dashed border-cyan-300/35 text-sm font-semibold text-cyan-100/70">
                    ບໍ່ມີປ້າຍ
                  </div>
                )}
              </div>
              {liveDraft ? (
                <button
                  type="button"
                  onClick={() => setPrintList([liveDraft])}
                  className="mt-3 w-full rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-bold text-cyan-900 shadow-sm transition hover:bg-cyan-100"
                >
                  ພິມປ້າຍນີ້
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---- Batch list ---- */}
        {batch.length > 0 ? (
          <div className="mt-6 rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_18px_46px_rgba(15,23,42,0.06)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-600">
                  Print Batch
                </div>
                <h2 className="mt-1 text-lg font-black text-slate-950">ຊຸດພິມ ({batch.length})</h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBatch([])}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  ລ້າງ
                </button>
                <button
                  type="button"
                  onClick={() => setPrintList(batch.map(withConfig))}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-cyan-100 shadow-[0_10px_24px_rgba(15,23,42,0.16)] transition hover:bg-slate-800"
                >
                  ພິມທັງໝົດ ({batch.length})
                </button>
              </div>
            </div>
            <div className="grid gap-5 rounded-2xl bg-slate-50 px-3 py-3 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
              {batch.map((t) => (
                <div key={t.id} className="pt-batch-fit relative">
                  <FitPriceTag data={withConfig(t)} size={tagSize} />
                  <button
                    type="button"
                    onClick={() => removeFromBatch(t.id)}
                    title="ລົບ"
                    className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white bg-red-600 text-sm font-bold text-white shadow"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- Hidden print surface (shown only when printing) ---- */}
      <div
        className={`pt-print-area${isASheetSize(tagSize) ? " pt-print-sheet" : ""}`}
        aria-hidden
      >
        {/* A-series sizes print one full-bleed landscape tag per sheet: the @page
            is the tag's own size with zero margin so the tag reaches the paper
            edges. Other sizes tile onto the chosen paper via .pt-print-grid. */}
        {(() => {
          const sheet = isASheetSize(tagSize);
          const d = sheet
            ? { w: TAG_SIZES[tagSize].widthMm, h: TAG_SIZES[tagSize].heightMm }
            : paperDimsMm(paperSize, orientation);
          const margin = sheet ? 0 : 6;
          return (
            <style>{`@media print { @page tag { size: ${d.w}mm ${d.h}mm; margin: ${margin}mm; } }`}</style>
          );
        })()}
        <div
          className="pt-print-grid"
          style={{ ["--pt-w" as string]: `${TAG_SIZES[tagSize].widthMm}mm` }}
        >
          {(printList ?? []).map((t) => (
            <PriceTag key={t.id} data={t} size={tagSize} />
          ))}
        </div>
      </div>
    </div>
  );
}
