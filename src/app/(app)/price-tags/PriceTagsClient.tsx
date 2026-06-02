"use client";

import { useEffect, useMemo, useState } from "react";
import PriceTag, { discountPercent, type PriceTagData } from "./PriceTag";

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

  // ---- print ----
  const [printList, setPrintList] = useState<PriceTagData[] | null>(null);

  useEffect(() => {
    void fetch("/api/promotions?active=1")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPromos(Array.isArray(data) ? data : []))
      .catch(() => setPromos([]));
  }, []);

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

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="pt-screen-only">
        <header className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
            ການຕະຫຼາດ
          </div>
          <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">ປ້າຍລາຄາສິນຄ້າ</h1>
          <p className="mt-1 text-sm text-odoo-text-muted">
            ສ້າງ ແລະ ພິມປ້າຍລາຄາ — ເລືອກໄດ້ຫຼາຍສິນຄ້າພ້ອມກັນ, ດຶງລາຄາ ແລະ ໂປຣໂມຊັນ ໂດຍອັດຕະໂນມັດ.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          {/* ---- Left: controls ---- */}
          <div className="min-w-0 space-y-4">
            {/* Product picker (multi-select) */}
            <div className="rounded-md border border-odoo-border bg-odoo-surface p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-odoo-text-strong">1. ເລືອກສິນຄ້າ (ໄດ້ຫຼາຍລາຍການ)</div>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    onClick={addSelectedToBatch}
                    className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
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
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-800"
                    >
                      {it.name}
                      <button
                        type="button"
                        onClick={() => toggleSelect(it)}
                        className="ml-0.5 text-blue-500 hover:text-blue-800"
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
                <div className="mt-3 max-h-80 overflow-y-auto rounded-md border border-odoo-border">
                  {results.map((r) => {
                    const checked = selected.has(r.code);
                    const hasPromo = promoByTrigger.has(r.code.trim());
                    return (
                      <div
                        key={r.code}
                        className={`flex items-center gap-2 border-b border-odoo-border px-3 py-2 text-sm last:border-b-0 ${
                          checked ? "bg-blue-50" : "hover:bg-odoo-surface-muted"
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
                              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
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
                          className="shrink-0 rounded border border-odoo-border px-2 py-0.5 text-[11px] font-semibold text-odoo-text-muted hover:bg-white"
                        >
                          ແກ້ໄຂ
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Editable fields (single fine-tune) */}
            {draft ? (
              <div className="rounded-md border border-odoo-border bg-odoo-surface p-4">
                <div className="text-sm font-bold text-odoo-text-strong">2. ແກ້ໄຂປ້າຍ</div>
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
                  className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
                >
                  + ເພີ່ມໃສ່ຊຸດພິມ
                </button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-odoo-border bg-odoo-surface-muted p-6 text-center text-sm text-odoo-text-muted">
                ໝາຍຕິກສິນຄ້າເພື່ອເພີ່ມໃສ່ຊຸດພິມ ຫຼື ກົດ “ແກ້ໄຂ” ເພື່ອປັບລະອຽດປ້າຍດຽວ
              </div>
            )}

            {/* Shared design config */}
            <div className="rounded-md border border-odoo-border bg-odoo-surface p-4">
              <div className="text-sm font-bold text-odoo-text-strong">3. ຮູບແບບ (ໃຊ້ກັບທຸກປ້າຍ)</div>
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
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
              ຕົວຢ່າງ
            </div>
            <div className="mt-2 flex justify-center rounded-md border border-odoo-border bg-odoo-surface-muted p-4">
              {liveDraft ? (
                <PriceTag data={liveDraft} />
              ) : (
                <div className="flex h-[84mm] w-[92mm] items-center justify-center text-sm text-odoo-text-muted">
                  ບໍ່ມີປ້າຍ
                </div>
              )}
            </div>
            {liveDraft ? (
              <button
                type="button"
                onClick={() => setPrintList([liveDraft])}
                className="mt-3 w-full rounded-md border border-odoo-border bg-white px-4 py-2 text-sm font-bold text-odoo-text-strong shadow-sm transition hover:bg-odoo-surface-muted"
              >
                ພິມປ້າຍນີ້
              </button>
            ) : null}
          </div>
        </div>

        {/* ---- Batch list ---- */}
        {batch.length > 0 ? (
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-black text-odoo-text-strong">ຊຸດພິມ ({batch.length})</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBatch([])}
                  className="rounded-md border border-odoo-border bg-white px-3 py-1.5 text-sm font-semibold text-odoo-text-strong transition hover:bg-odoo-surface-muted"
                >
                  ລ້າງ
                </button>
                <button
                  type="button"
                  onClick={() => setPrintList(batch.map(withConfig))}
                  className="rounded-md bg-blue-700 px-4 py-1.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
                >
                  ພິມທັງໝົດ ({batch.length})
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {batch.map((t) => (
                <div key={t.id} className="relative">
                  <PriceTag data={withConfig(t)} />
                  <button
                    type="button"
                    onClick={() => removeFromBatch(t.id)}
                    title="ລົບ"
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white shadow"
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
      <div className="pt-print-area" aria-hidden>
        <div className="pt-print-grid">
          {(printList ?? []).map((t) => (
            <PriceTag key={t.id} data={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
