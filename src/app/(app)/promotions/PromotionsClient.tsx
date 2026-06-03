"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type PromoType = "bogo" | "item_pair_price" | "fixed_price_period";

type Promotion = {
  id: string;
  name: string;
  promoType: PromoType | string;
  isActive: boolean;
  startAt: string | Date | null;
  endAt: string | Date | null;
  timeFrom: string | null;
  timeTo: string | null;
  triggerItemCode: string | null;
  triggerQty: number | null;
  bonusItemCode: string | null;
  bonusQty: number | null;
  bonusPriceKip: number | null;
  fixedPriceKip: number | null;
  awardsPoints: boolean;
  awardsMemberDiscount: boolean;
  note: string | null;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type FormState = Partial<{
  name: string;
  promoType: PromoType;
  isActive: boolean;
  startAt: string;
  endAt: string;
  timeFrom: string;
  timeTo: string;
  triggerItemCode: string;
  triggerQty: string;
  bonusItemCode: string;
  bonusQty: string;
  bonusPriceKip: string;
  fixedPriceKip: string;
  awardsPoints: boolean;
  awardsMemberDiscount: boolean;
  note: string;
}>;

const PROMO_LABELS: Record<PromoType, string> = {
  bogo: "ຊື້ 1 ແຖມ 1",
  item_pair_price: "ຊື້ A ໄດ້ B ໃນລາຄາພິເສດ",
  fixed_price_period: "ລາຄາພິເສດ ໃນຊ່ວງເວລາ",
};

const PROMO_DESCRIPTIONS: Record<PromoType, string> = {
  bogo: "ລູກຄ້າຊື້ສິນຄ້າຫຼັກຕາມລາຄາທີ່ກຳນົດ → ສິນຄ້າແຖມຟຣີ",
  item_pair_price:
    "ລູກຄ້າຊື້ສິນຄ້າທີ 1 → ສິນຄ້າທີ 2 ຄິດໃນລາຄາທີ່ກຳນົດ",
  fixed_price_period:
    "ສິນຄ້າຂາຍໃນລາຄາພິເສດ ສະເພາະຊ່ວງເວລາ start_at..end_at",
};

const PROMO_METHODS: Record<
  PromoType,
  { title: string; steps: string[]; result: string }
> = {
  bogo: {
    title: "ວິທີຄິດແບບຊື້ແຖມ",
    steps: [
      "ເລືອກສິນຄ້າຕົ້ນທີ່ລູກຄ້າຕ້ອງຊື້",
      "ກຳນົດຈຳນວນທີ່ຕ້ອງຊື້ ແລະ ລາຄາສິນຄ້າຕົ້ນ",
      "ເລືອກສິນຄ້າແຖມ ແລະ ຈຳນວນທີ່ແຖມ",
    ],
    result: "ເມື່ອກະຕ່າຄົບເງື່ອນໄຂ ລະບົບຈະໃຫ້ສິນຄ້າແຖມຕາມທີ່ກຳນົດ",
  },
  item_pair_price: {
    title: "ວິທີຄິດແບບຊື້ຄູ່ລາຄາພິເສດ",
    steps: [
      "ເລືອກສິນຄ້າທີ 1 ທີ່ລູກຄ້າຕ້ອງຊື້",
      "ເລືອກສິນຄ້າທີ 2 ທີ່ຈະໄດ້ລາຄາພິເສດ",
      "ກຳນົດລາຄາພິເສດຂອງສິນຄ້າທີ 2",
    ],
    result: "ຖ້າກະຕ່າມີສິນຄ້າທັງ 2 ລາຍການ ລາຄາສິນຄ້າທີ 2 ຈະຖືກປັບຕາມໂປຣໂມຊັນ",
  },
  fixed_price_period: {
    title: "ວິທີຄິດແບບລາຄາພິເສດຕາມເວລາ",
    steps: [
      "ເລືອກສິນຄ້າທີ່ຈະລົດລາຄາ",
      "ກຳນົດລາຄາພິເສດ",
      "ກຳນົດຊ່ວງວັນ ຫຼື ເວລາທີ່ໃຫ້ໃຊ້ໂປຣໂມຊັນ",
    ],
    result: "ສິນຄ້າຈະໃຊ້ລາຄາພິເສດສະເພາະຊ່ວງເວລາທີ່ກຳນົດ",
  },
};

const moneyFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function toDateInputValue(v: string | Date | null): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  return iso.slice(0, 16);
}

function fromForm(form: FormState): unknown {
  return {
    name: form.name?.trim() ?? "",
    promoType: form.promoType ?? "bogo",
    isActive: form.isActive ?? true,
    startAt: form.startAt || null,
    endAt: form.endAt || null,
    timeFrom: form.timeFrom || null,
    timeTo: form.timeTo || null,
    triggerItemCode: form.triggerItemCode?.trim() || null,
    triggerQty: form.triggerQty ?? null,
    bonusItemCode: form.bonusItemCode?.trim() || null,
    bonusQty: form.bonusQty ?? null,
    bonusPriceKip: form.bonusPriceKip ?? null,
    fixedPriceKip: form.fixedPriceKip ?? null,
    awardsPoints: form.awardsPoints ?? true,
    awardsMemberDiscount: form.awardsMemberDiscount ?? true,
    note: form.note?.trim() || null,
  };
}

function promoToForm(p: Promotion): FormState {
  return {
    name: p.name,
    promoType: p.promoType as PromoType,
    isActive: p.isActive,
    startAt: toDateInputValue(p.startAt),
    endAt: toDateInputValue(p.endAt),
    timeFrom: p.timeFrom ?? "",
    timeTo: p.timeTo ?? "",
    triggerItemCode: p.triggerItemCode ?? "",
    triggerQty: p.triggerQty?.toString() ?? "",
    bonusItemCode: p.bonusItemCode ?? "",
    bonusQty: p.bonusQty?.toString() ?? "",
    bonusPriceKip: p.bonusPriceKip?.toString() ?? "",
    fixedPriceKip: p.fixedPriceKip?.toString() ?? "",
    awardsPoints: p.awardsPoints,
    awardsMemberDiscount: p.awardsMemberDiscount,
    note: p.note ?? "",
  };
}

export default function PromotionsClient({
  initialPromotions,
  canManage,
}: {
  initialPromotions: Promotion[];
  canManage: boolean;
}) {
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions);
  const [filter, setFilter] = useState<"ALL" | PromoType>("ALL");
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    return filter === "ALL"
      ? promotions
      : promotions.filter((p) => p.promoType === filter);
  }, [filter, promotions]);

  function reload() {
    fetch("/api/promotions")
      .then((r) => r.json())
      .then((rows: Promotion[]) => setPromotions(rows))
      .catch(() => {});
  }

  async function removePromotion(p: Promotion) {
    if (!confirm(`ລົບ ໂປຣໂມຊັນ "${p.name}"?`)) return;
    // Optimistic update — drop the row immediately so the click feels
    // instant; reload from the server afterwards to reconcile any other
    // changes made concurrently.
    setPromotions((prev) => prev.filter((it) => it.id !== p.id));
    try {
      const res = await fetch(`/api/promotions/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch {
      reload();
      return;
    }
    reload();
  }

  return (
    <div className="px-3 py-4 sm:px-6 sm:py-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-odoo-text-strong">
            ໂປຣໂມຊັນ
          </h1>
          <p className="mt-1 text-sm text-odoo-text-muted">
            ຈັດການ ໂປຣໂມຊັນ 3 ປະເພດ ສຳລັບຮ້ານຄ້າ — ຜູ້ຈັດການເທົ່ານັ້ນທີ່ສ້າງ ຫຼື ແກ້ໄຂໄດ້.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="odoo-btn odoo-btn-secondary"
              onClick={() => setImporting(true)}
            >
              ນຳເຂົ້າ Excel
            </button>
            <button
              type="button"
              className="odoo-btn odoo-btn-primary"
              onClick={() => setCreating(true)}
            >
              + ສ້າງ ໂປຣໂມຊັນ
            </button>
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(["ALL", "bogo", "item_pair_price", "fixed_price_period"] as const).map(
          (key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                "rounded-full border px-3 py-1 text-xs font-semibold transition " +
                (filter === key
                  ? "border-odoo-primary bg-odoo-primary text-white"
                  : "border-odoo-border bg-white text-odoo-text-muted hover:border-odoo-primary")
              }
            >
              {key === "ALL" ? "ທັງໝົດ" : PROMO_LABELS[key]}
            </button>
          ),
        )}
      </div>

      <div className="overflow-hidden rounded border border-odoo-border bg-white">
        <div className="overflow-x-auto">
        <table className="min-w-[600px] text-sm">
          <thead className="bg-odoo-surface-muted text-left text-[11px] uppercase text-odoo-text-muted">
            <tr>
              <th className="px-4 py-3">ປະເພດ</th>
              <th className="px-4 py-3">ຊື່</th>
              <th className="px-4 py-3">ສິນຄ້າ / ລາຄາ</th>
              <th className="px-4 py-3">ຊ່ວງເວລາ</th>
              <th className="px-4 py-3 text-center">ສະຖານະ</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-odoo-text-muted"
                >
                  ຍັງບໍ່ມີ ໂປຣໂມຊັນ
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} className="border-t border-odoo-border">
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-odoo-primary-50 px-2 py-0.5 text-[10px] font-semibold text-odoo-primary">
                      {PROMO_LABELS[p.promoType as PromoType] ?? p.promoType}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-odoo-text-strong">
                    {p.name}
                    {p.note ? (
                      <div className="mt-0.5 text-[11px] font-normal text-odoo-text-muted">
                        {p.note}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-odoo-text">
                    <PromoDetail p={p} />
                  </td>
                  <td className="px-4 py-3 text-xs text-odoo-text-muted">
                    <DateRange start={p.startAt} end={p.endAt} />
                    {p.timeFrom || p.timeTo ? (
                      <div className="mt-0.5 text-[10px]">
                        ເວລາ: {p.timeFrom ?? "--"}–{p.timeTo ?? "--"}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                          (p.isActive
                            ? "bg-odoo-success-bg text-odoo-success"
                            : "bg-odoo-surface-muted text-odoo-text-muted")
                        }
                      >
                        {p.isActive ? "ເປີດ" : "ປິດ"}
                      </span>
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                          (p.awardsPoints
                            ? "bg-amber-50 text-amber-700"
                            : "bg-odoo-surface-muted text-odoo-text-muted line-through")
                        }
                        title={
                          p.awardsPoints
                            ? "ສິນຄ້າໃນໂປຣນີ້ນັບແຕ້ມສະສົມ"
                            : "ສິນຄ້າໃນໂປຣນີ້ບໍ່ນັບແຕ້ມສະສົມ"
                        }
                      >
                        ★ ນັບແຕ້ມ
                      </span>
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                          (p.awardsMemberDiscount
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-odoo-surface-muted text-odoo-text-muted line-through")
                        }
                        title={
                          p.awardsMemberDiscount
                            ? "ສິນຄ້າໃນໂປຣນີ້ໄດ້ສ່ວນຫຼຸດສະມາຊິກເພີ່ມ"
                            : "ສິນຄ້າໃນໂປຣນີ້ບໍ່ໄດ້ສ່ວນຫຼຸດສະມາຊິກເພີ່ມ"
                        }
                      >
                        ♛ ສ່ວນຫຼຸດສະມາຊິກ
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-odoo-primary hover:underline"
                          onClick={() => setEditing(p)}
                        >
                          ແກ້ໄຂ
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-odoo-danger hover:underline"
                          onClick={() => removePromotion(p)}
                        >
                          ລົບ
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {creating ? (
        <PromoEditor
          mode="create"
          initial={undefined}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}
      {editing ? (
        <PromoEditor
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
      {importing ? (
        <ImportPromotionsModal
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PromoDetail({ p }: { p: Promotion }) {
  switch (p.promoType) {
    case "bogo":
      return (
        <div>
          <div>
            ຊື້ {p.triggerQty ?? "—"} ×{" "}
            <span className="font-mono">{p.triggerItemCode ?? "—"}</span>
          </div>
          <div className="text-odoo-success">
            ແຖມ {p.bonusQty ?? "—"} ×{" "}
            <span className="font-mono">{p.bonusItemCode ?? "—"}</span>
          </div>
          <div>
            ລາຄາສິນຄ້າຫຼັກ:{" "}
            <span className="font-bold text-odoo-text-strong">
              {p.bonusPriceKip != null
                ? `${moneyFmt.format(p.bonusPriceKip)} ກີບ`
                : "—"}
            </span>
          </div>
        </div>
      );
    case "item_pair_price":
      return (
        <div>
          <div>
            ຊື້ <span className="font-mono">{p.triggerItemCode ?? "—"}</span>
          </div>
          <div>
            ສິນຄ້າ 2:{" "}
            <span className="font-mono">{p.bonusItemCode ?? "—"}</span> @{" "}
            <span className="font-bold text-odoo-text-strong">
              {p.bonusPriceKip != null
                ? `${moneyFmt.format(p.bonusPriceKip)} ກີບ`
                : "—"}
            </span>
          </div>
        </div>
      );
    case "fixed_price_period":
      return (
        <div>
          <div>
            <span className="font-mono">{p.triggerItemCode ?? "—"}</span>
          </div>
          <div className="font-bold text-odoo-text-strong">
            {p.fixedPriceKip != null
              ? `${moneyFmt.format(p.fixedPriceKip)} ກີບ`
              : "—"}
          </div>
        </div>
      );
    default:
      return <span className="text-odoo-text-muted">—</span>;
  }
}

function DateRange({
  start,
  end,
}: {
  start: string | Date | null;
  end: string | Date | null;
}) {
  function fmt(v: string | Date | null) {
    if (!v) return "—";
    const d = typeof v === "string" ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return "—";
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${d.getUTCFullYear()}`;
  }
  if (!start && !end) return <span>ບໍ່ມີຂອບເຂດເວລາ</span>;
  return (
    <span>
      {fmt(start)} → {fmt(end)}
    </span>
  );
}

function PromoEditor({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: Promotion | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? promoToForm(initial)
      : {
          promoType: "bogo",
          isActive: true,
          triggerQty: "1",
          bonusQty: "1",
          awardsPoints: true,
          awardsMemberDiscount: true,
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promoType = (form.promoType ?? "bogo") as PromoType;

  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify(fromForm(form));
      const url =
        mode === "create"
          ? "/api/promotions"
          : `/api/promotions/${initial!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`ລົບ ໂປຣໂມຊັນ "${initial.name}"?`)) return;
    setSaving(true);
    try {
      await fetch(`/api/promotions/${initial.id}`, { method: "DELETE" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
                {mode === "create" ? "ສ້າງລາຍການໃໝ່" : "ແກ້ໄຂລາຍການ"}
              </div>
              <h2 className="mt-1 text-2xl font-black text-odoo-text-strong">
                ຕັ້ງຄ່າໂປຣໂມຊັນ
              </h2>
              <p className="mt-1 text-sm text-odoo-text-muted">
                ກຳນົດຊື່, ວິທີຄິດ, ສິນຄ້າ, ລາຄາ ແລະ ຊ່ວງເວລາໃຫ້ກົງກັບໜ້າຂາຍ.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-sm font-semibold text-odoo-text-strong">
                <input
                  type="checkbox"
                  checked={form.isActive ?? true}
                  onChange={(e) => update("isActive", e.target.checked)}
                />
                <span>ເປີດໃຊ້ງານ</span>
              </label>
              <label
                className="flex items-center gap-2 rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-sm font-semibold text-odoo-text-strong"
                title="ປິດ → ສິນຄ້າໃນໂປຣນີ້ບໍ່ນັບແຕ້ມສະສົມ"
              >
                <input
                  type="checkbox"
                  checked={form.awardsPoints ?? true}
                  onChange={(e) => update("awardsPoints", e.target.checked)}
                />
                <span>ນັບແຕ້ມ</span>
              </label>
              <label
                className="flex items-center gap-2 rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-sm font-semibold text-odoo-text-strong"
                title="ປິດ → ສິນຄ້າໃນໂປຣນີ້ບໍ່ໄດ້ສ່ວນຫຼຸດສະມາຊິກເພີ່ມ"
              >
                <input
                  type="checkbox"
                  checked={form.awardsMemberDiscount ?? true}
                  onChange={(e) =>
                    update("awardsMemberDiscount", e.target.checked)
                  }
                />
                <span>ສ່ວນຫຼຸດສະມາຊິກ</span>
              </label>
            </div>
          </div>
        </header>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-4 py-4 text-sm sm:px-6 sm:py-5">
          <section>
            <SectionTitle
              number="1"
              title="ຂໍ້ມູນຫຼັກ"
              description="ຕັ້ງຊື່ໃຫ້ສັ້ນ ແລະ ເລືອກປະເພດໂປຣໂມຊັນທີ່ຈະໃຊ້."
            />
            <div className="mt-3 grid gap-4 grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px]">
              <Field label="ຫົວຂໍ້ໂປຣໂມຊັນ">
                <input
                  type="text"
                  className="odoo-input w-full"
                  value={form.name ?? ""}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="ເຊັ່ນ: ຊື້ແອ 1 ແຖມຂາຕັ້ງ 1"
                />
              </Field>

              <Field label="ປະເພດໂປຣໂມຊັນ">
                <select
                  className="odoo-input w-full"
                  value={promoType}
                  onChange={(e) => {
                    const next = e.target.value as PromoType;
                    // BOGO ("ຊື້ 1 ແຖມ 1") defaults trigger/bonus qty to 1 if
                    // the user hasn't typed anything — the typical use case is
                    // 1-for-1, so prefilling saves a step.
                    setForm((prev) => ({
                      ...prev,
                      promoType: next,
                      triggerQty:
                        next === "bogo" && !prev.triggerQty
                          ? "1"
                          : prev.triggerQty,
                      bonusQty:
                        next === "bogo" && !prev.bonusQty
                          ? "1"
                          : prev.bonusQty,
                    }));
                  }}
                  disabled={mode === "edit"}
                >
                  {(Object.keys(PROMO_LABELS) as PromoType[]).map((k) => (
                    <option key={k} value={k}>
                      {PROMO_LABELS[k]}
                    </option>
                  ))}
                </select>
                {mode === "edit" ? (
                  <p className="mt-1 text-[10px] text-odoo-text-muted">
                    ປະເພດປ່ຽນບໍ່ໄດ້ຫຼັງສ້າງ. ຖ້າຈະປ່ຽນປະເພດ ໃຫ້ສ້າງລາຍການໃໝ່.
                  </p>
                ) : null}
              </Field>
            </div>
          </section>

          <section>
            <SectionTitle
              number="2"
              title="ວິທີການ"
              description={PROMO_DESCRIPTIONS[promoType]}
            />
            <PromoMethodGuide type={promoType} />
          </section>

          <section>
            <SectionTitle
              number="3"
              title="ເງື່ອນໄຂ ແລະ ລາຄາ"
              description="ໃສ່ສິນຄ້າ ແລະ ຈຳນວນໃຫ້ຄົບຕາມວິທີການຂ້າງເທິງ."
            />

            {promoType === "bogo" ? (
              <div className="mt-3 grid gap-4 grid-cols-1 sm:grid-cols-2">
                <Field label="ເລືອກສິນຄ້າທີ່ລູກຄ້າຕ້ອງຊື້">
                  <ItemCodePicker
                    value={form.triggerItemCode ?? ""}
                    onChange={(v) => update("triggerItemCode", v)}
                  />
                </Field>
                <Field label="ຈຳນວນທີ່ຕ້ອງຊື້">
                  <input
                    type="number"
                    min={1}
                    className="odoo-input w-full"
                    value={form.triggerQty ?? ""}
                    onChange={(e) => update("triggerQty", e.target.value)}
                    placeholder="1"
                  />
                </Field>
                <Field label="ສິນຄ້າທີ່ແຖມ">
                  <ItemCodePicker
                    value={form.bonusItemCode ?? ""}
                    onChange={(v) => update("bonusItemCode", v)}
                  />
                </Field>
                <Field label="ຈຳນວນທີ່ແຖມ">
                  <input
                    type="number"
                    min={1}
                    className="odoo-input w-full"
                    value={form.bonusQty ?? ""}
                    onChange={(e) => update("bonusQty", e.target.value)}
                    placeholder="1"
                  />
                </Field>
                <Field label="ລາຄາສິນຄ້າທີ່ຕ້ອງຊື້">
                  <input
                    type="number"
                    min={1}
                    className="odoo-input w-full"
                    value={form.bonusPriceKip ?? ""}
                    onChange={(e) => update("bonusPriceKip", e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
            ) : promoType === "item_pair_price" ? (
              <div className="mt-3 grid gap-4 grid-cols-1 sm:grid-cols-2">
                <Field label="ສິນຄ້າທີ່ຕ້ອງຊື້ກ່ອນ">
                  <ItemCodePicker
                    value={form.triggerItemCode ?? ""}
                    onChange={(v) => update("triggerItemCode", v)}
                  />
                </Field>
                <Field label="ສິນຄ້າທີ່ໄດ້ລາຄາພິເສດ">
                  <ItemCodePicker
                    value={form.bonusItemCode ?? ""}
                    onChange={(v) => update("bonusItemCode", v)}
                  />
                </Field>
                <Field label="ລາຄາພິເສດຂອງສິນຄ້າທີ 2">
                  <input
                    type="number"
                    min={0}
                    className="odoo-input w-full"
                    value={form.bonusPriceKip ?? ""}
                    onChange={(e) => update("bonusPriceKip", e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
            ) : (
              <div className="mt-3 grid gap-4 grid-cols-1 sm:grid-cols-2">
                <Field label="ສິນຄ້າທີ່ຈະໃຊ້ລາຄາພິເສດ">
                  <ItemCodePicker
                    value={form.triggerItemCode ?? ""}
                    onChange={(v) => update("triggerItemCode", v)}
                  />
                </Field>
                <Field label="ລາຄາພິເສດ">
                  <input
                    type="number"
                    min={0}
                    className="odoo-input w-full"
                    value={form.fixedPriceKip ?? ""}
                    onChange={(e) => update("fixedPriceKip", e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
            )}
          </section>

          <section>
            <SectionTitle
              number="4"
              title="ຊ່ວງເວລາ"
              description="ປ່ອຍວ່າງໄດ້ຖ້າຕ້ອງການໃຫ້ໃຊ້ໄດ້ຕະຫຼອດ."
            />
            <div className="mt-3 grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Field label="ວັນເລີ່ມ">
                <input
                  type="datetime-local"
                  className="odoo-input w-full"
                  value={form.startAt ?? ""}
                  onChange={(e) => update("startAt", e.target.value)}
                />
              </Field>
              <Field label="ວັນສິ້ນສຸດ">
                <input
                  type="datetime-local"
                  className="odoo-input w-full"
                  value={form.endAt ?? ""}
                  onChange={(e) => update("endAt", e.target.value)}
                />
              </Field>
              <Field label="ເວລາເລີ່ມຕໍ່ມື້">
                <input
                  type="time"
                  className="odoo-input w-full"
                  value={form.timeFrom ?? ""}
                  onChange={(e) => update("timeFrom", e.target.value)}
                />
              </Field>
              <Field label="ເວລາສິ້ນສຸດຕໍ່ມື້">
                <input
                  type="time"
                  className="odoo-input w-full"
                  value={form.timeTo ?? ""}
                  onChange={(e) => update("timeTo", e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section>
            <SectionTitle
              number="5"
              title="ໝາຍເຫດ"
              description="ໃສ່ລາຍລະອຽດພາຍໃນສຳລັບທີມງານ."
            />
            <div className="mt-3">
              <textarea
                className="odoo-input w-full"
                rows={3}
                value={form.note ?? ""}
                onChange={(e) => update("note", e.target.value)}
                placeholder="ເຊັ່ນ: ໃຊ້ສະເພາະຊ່ວງເປີດຕົວສິນຄ້າ"
              />
            </div>
          </section>

          {error ? (
            <div className="odoo-alert-danger px-3 py-2 text-sm">{error}</div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between border-t border-odoo-border bg-odoo-surface-muted px-5 py-3">
          <div>
            {mode === "edit" ? (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="text-xs font-semibold text-odoo-danger hover:underline"
              >
                ລົບ
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="odoo-btn odoo-btn-secondary"
              disabled={saving}
            >
              ຍົກເລີກ
            </button>
            <button
              type="button"
              onClick={save}
              className="odoo-btn odoo-btn-primary"
              disabled={saving}
            >
              {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-odoo-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-odoo-primary text-[11px] font-black text-white">
        {number}
      </span>
      <div>
        <h3 className="text-sm font-black text-odoo-text-strong">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-odoo-text-muted">
          {description}
        </p>
      </div>
    </div>
  );
}

function PromoMethodGuide({ type }: { type: PromoType }) {
  const method = PROMO_METHODS[type];
  return (
    <div className="mt-3 rounded-md border border-odoo-border bg-odoo-surface-muted px-4 py-3">
      <div className="text-xs font-black text-odoo-text-strong">
        {method.title}
      </div>
      <div className="mt-3 grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
        {method.steps.map((step, idx) => (
          <div
            key={step}
            className="rounded-md border border-odoo-border bg-white px-3 py-2"
          >
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-odoo-primary">
              ຂັ້ນຕອນ {idx + 1}
            </div>
            <div className="text-xs leading-5 text-odoo-text">{step}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">
        ຜົນລັບ: {method.result}
      </div>
    </div>
  );
}

// Item picker backed by /api/inventory/search. Typing the input fires a
// debounced server-side lookup against ic_inventory; the selected code is
// what's actually stored in the form. We resolve the "display name" once on
// mount (when editing) so existing rows show the human-readable label.
type InventoryHit = { code: string; name: string; unit: string | null };

function ItemCodePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InventoryHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  // When the form already has a code (edit mode), fetch its display name once
  // so the chip reads "ABC-123 — ນ້ຳດື່ມ" instead of just the code.
  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    // Display-name lookup intentionally omits inStock filter so saved
    // promos still resolve their item label even if it has since gone
    // out of stock — we want the user to see what they previously chose.
    fetch(`/api/inventory/search?q=${encodeURIComponent(value)}&limit=5`)
      .then((r) => r.json())
      .then((rows: InventoryHit[]) => {
        if (cancelled) return;
        const hit = rows.find((r) => r.code === value);
        if (hit) setDisplayName(hit.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Close on outside click so the dropdown doesn't trap focus inside the
  // modal when the user moves on to another field.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function runSearch(q: string) {
    const seq = ++seqRef.current;
    setLoading(true);
    // inStock=1 — only items with positive company-wide balance can be
    // bound to a promotion, per business rule.
    fetch(
      `/api/inventory/search?q=${encodeURIComponent(q)}&limit=50&inStock=1`,
    )
      .then((r) => r.json())
      .then((rows: InventoryHit[]) => {
        if (seq !== seqRef.current) return;
        setResults(rows);
      })
      .catch(() => {
        if (seq === seqRef.current) setResults([]);
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }

  function onQueryChanged(v: string) {
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => runSearch(v.trim()), 250);
  }

  function pick(hit: InventoryHit) {
    onChange(hit.code);
    setDisplayName(hit.name);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="mb-1 flex items-center gap-2 rounded border border-odoo-border bg-odoo-surface-muted px-2 py-1 text-xs">
          <span className="font-mono font-bold text-odoo-text-strong">
            {value}
          </span>
          {displayName ? (
            <span className="truncate text-odoo-text-muted">
              — {displayName}
            </span>
          ) : null}
          <button
            type="button"
            className="ml-auto text-odoo-text-muted hover:text-odoo-danger"
            onClick={() => {
              onChange("");
              setDisplayName(null);
              setQuery("");
            }}
            aria-label="ລົບ"
          >
            ×
          </button>
        </div>
      ) : null}
      {value ? null : (
        <input
          type="text"
          placeholder=""
          className="odoo-input w-full"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          value={query}
          onChange={(e) => onQueryChanged(e.target.value)}
          onFocus={() => {
            setOpen(true);
            if (query.trim() && results.length === 0) runSearch(query.trim());
          }}
        />
      )}
      {!value && open && (loading || query.trim() !== "") ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded border border-odoo-border bg-white shadow-lg"
        >
          {loading ? (
            <div className="px-3 py-2 text-xs text-odoo-text-muted">
              ກຳລັງຄົ້ນຫາ...
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-odoo-text-muted">
              ບໍ່ພົບສິນຄ້າ
            </div>
          ) : (
            results.map((hit) => (
              <button
                key={hit.code}
                type="button"
                role="option"
                aria-selected={hit.code === value}
                onClick={() => pick(hit)}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-odoo-primary-50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-odoo-text-strong">
                    {hit.code}
                  </span>
                  {hit.unit ? (
                    <span className="rounded bg-odoo-surface-muted px-1.5 py-0.5 text-[10px] text-odoo-text-muted">
                      {hit.unit}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-odoo-text">{hit.name}</div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// RFC4180-ish CSV parser. Inline because the only place we read CSV is this
// modal, the data shape is small (~12 columns), and pulling in PapaParse for
// a single screen wasn't worth the bundle weight.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop trailing empty rows (common when Excel exports a trailing newline).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

const CSV_COLUMNS = [
  "name",
  "promoType",
  "isActive",
  "startAt",
  "endAt",
  "triggerItemCode",
  "triggerQty",
  "bonusItemCode",
  "bonusQty",
  "bonusPriceKip",
  "fixedPriceKip",
  "awardsPoints",
  "awardsMemberDiscount",
  "note",
] as const;

function parseBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "t";
}

function parseDateTimeOrNull(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  // Accept "YYYY-MM-DD HH:MM" or "YYYY-MM-DD". The API ingests both since
  // ic_trans-style datetime strings work through Date.parse.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) {
    return v.replace(" ", "T").slice(0, 16);
  }
  return v;
}

function parseNumberOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type ImportRowResult = {
  rowNumber: number;
  name: string;
  status: "ok" | "error";
  error?: string;
};

function ImportPromotionsModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportRowResult[]>([]);

  function downloadTemplate() {
    // Build the template as a real .xlsx — opens cleanly in Excel/LibreOffice
    // without the "save as text encoding" prompt that CSV always triggers.
    const data: string[][] = [
      [...CSV_COLUMNS],
      [
        "Example BOGO",
        "bogo",
        "1",
        "2026-06-01 00:00",
        "2026-06-30 23:59",
        "110101-0001",
        "2",
        "110101-0002",
        "1",
        "",
        "",
        "1",
        "",
      ],
      [
        "Example Pair",
        "item_pair_price",
        "1",
        "2026-06-01 00:00",
        "2026-06-30 23:59",
        "110101-0001",
        "1",
        "110101-0002",
        "1",
        "50000",
        "",
        "1",
        "",
      ],
      [
        "Example Fixed",
        "fixed_price_period",
        "1",
        "2026-06-01 00:00",
        "2026-06-30 23:59",
        "110101-0001",
        "",
        "",
        "",
        "",
        "500000",
        "0",
        "",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "promotions");
    XLSX.writeFile(wb, "promotions-template.xlsx");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setResults([]);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    // Accept both .xlsx/.xls (parsed via SheetJS) and .csv (in-house parser).
    // We branch on extension because XLSX.read on raw CSV bytes occasionally
    // misclassifies columns when there's no BOM.
    const isCsv = /\.csv$/i.test(file.name);
    let headers: string[] = [];
    let rowsAoa: (string | number | null)[][] = [];

    if (isCsv) {
      const text = (await file.text()).replace(/^﻿/, "");
      const parsed = parseCSV(text);
      if (parsed.length < 1) {
        setParseError("ໄຟລ໌ບໍ່ມີຂໍ້ມູນ");
        setRows([]);
        return;
      }
      headers = parsed[0].map((h) => h.trim());
      rowsAoa = parsed.slice(1);
    } else {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        setParseError("ໄຟລ໌ Excel ບໍ່ມີ sheet");
        setRows([]);
        return;
      }
      const sheet = wb.Sheets[firstSheetName];
      const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      if (aoa.length < 1) {
        setParseError("Sheet ບໍ່ມີຂໍ້ມູນ");
        setRows([]);
        return;
      }
      headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
      rowsAoa = aoa.slice(1);
    }

    const missingCols = CSV_COLUMNS.filter((c) => !headers.includes(c));
    if (missingCols.length > 0) {
      setParseError(`ບໍ່ມີຄໍລຳ: ${missingCols.join(", ")}`);
      setRows([]);
      return;
    }

    const objs: Record<string, string>[] = [];
    for (const row of rowsAoa) {
      const cells = row.map((c) => String(c ?? "").trim());
      if (cells.every((c) => c === "")) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, j) => {
        obj[h] = cells[j] ?? "";
      });
      objs.push(obj);
    }
    setRows(objs);
  }

  function rowToPayload(r: Record<string, string>) {
    return {
      name: r.name,
      promoType: r.promoType,
      isActive: parseBool(r.isActive),
      startAt: parseDateTimeOrNull(r.startAt),
      endAt: parseDateTimeOrNull(r.endAt),
      timeFrom: null,
      timeTo: null,
      triggerItemCode: r.triggerItemCode || null,
      triggerQty: parseNumberOrNull(r.triggerQty),
      bonusItemCode: r.bonusItemCode || null,
      bonusQty: parseNumberOrNull(r.bonusQty),
      bonusPriceKip: parseNumberOrNull(r.bonusPriceKip),
      fixedPriceKip: parseNumberOrNull(r.fixedPriceKip),
      // awardsPoints / awardsMemberDiscount columns control whether
      // sales under this promo count toward loyalty points / stack with
      // the member discount; empty / missing → default TRUE.
      awardsPoints:
        r.awardsPoints === undefined || r.awardsPoints === ""
          ? true
          : parseBool(r.awardsPoints),
      awardsMemberDiscount:
        r.awardsMemberDiscount === undefined || r.awardsMemberDiscount === ""
          ? true
          : parseBool(r.awardsMemberDiscount),
      note: r.note || null,
    };
  }

  async function runImport() {
    if (importing || rows.length === 0) return;
    setImporting(true);
    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const res = await fetch("/api/promotions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rowToPayload(r)),
        });
        if (res.ok) {
          results.push({ rowNumber: i + 2, name: r.name, status: "ok" });
        } else {
          const data = await res.json().catch(() => null);
          results.push({
            rowNumber: i + 2,
            name: r.name,
            status: "error",
            error: data?.error ?? `HTTP ${res.status}`,
          });
        }
      } catch (err) {
        results.push({
          rowNumber: i + 2,
          name: r.name,
          status: "error",
          error: err instanceof Error ? err.message : "Network error",
        });
      }
      // Render progress incrementally so the user sees rows turning green
      // one at a time instead of waiting for everything to finish.
      setResults([...results]);
    }
    setImporting(false);
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  const done = results.length > 0 && results.length === rows.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={done ? onDone : onClose}
      />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border px-4 py-4 sm:px-5">
          <h2 className="text-lg font-bold text-odoo-text-strong">
            ນຳເຂົ້າ ໂປຣໂມຊັນ ຈາກ Excel
          </h2>
          <p className="mt-1 text-xs text-odoo-text-muted">
            ດາວໂຫລດແມ່ແບບ (.xlsx) ໃສ່ຂໍ້ມູນໃນ Excel ແລ້ວ upload ກັບໄດ້ໂດຍກົງ. ຮັບ .xlsx / .xls / .csv.
          </p>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadTemplate}
              className="odoo-btn odoo-btn-secondary"
            >
              ດາວໂຫລດແມ່ແບບ
            </button>
            <label className="odoo-btn odoo-btn-secondary cursor-pointer">
              ເລືອກໄຟລ໌ Excel
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={onFile}
                className="hidden"
              />
            </label>
            {fileName ? (
              <span className="text-xs text-odoo-text-muted">{fileName}</span>
            ) : null}
          </div>

          {parseError ? (
            <div className="odoo-alert-danger mb-3 px-3 py-2 text-sm">
              {parseError}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <>
              <div className="mb-2 text-[12px] font-bold text-odoo-text-strong">
                ຕົວຢ່າງ ({rows.length} ແຖວ)
              </div>
              <div className="mb-4 max-h-72 overflow-auto rounded-md border border-odoo-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-odoo-surface-muted text-odoo-text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">ຊື່</th>
                      <th className="px-2 py-1 text-left">ປະເພດ</th>
                      <th className="px-2 py-1 text-left">ເລີ່ມ</th>
                      <th className="px-2 py-1 text-left">ສິ້ນສຸດ</th>
                      <th className="px-2 py-1 text-left">ສະຖານະ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => {
                      const res = results[idx];
                      return (
                        <tr
                          key={idx}
                          className="border-t border-odoo-border align-top"
                        >
                          <td className="px-2 py-1 font-mono text-odoo-text-muted">
                            {idx + 2}
                          </td>
                          <td className="px-2 py-1 font-semibold text-odoo-text-strong">
                            {r.name}
                          </td>
                          <td className="px-2 py-1 font-mono">{r.promoType}</td>
                          <td className="px-2 py-1 font-mono">{r.startAt}</td>
                          <td className="px-2 py-1 font-mono">{r.endAt}</td>
                          <td className="px-2 py-1">
                            {res ? (
                              res.status === "ok" ? (
                                <span className="text-emerald-700">✓ ສຳເລັດ</span>
                              ) : (
                                <span className="text-rose-700">
                                  ✗ {res.error}
                                </span>
                              )
                            ) : (
                              <span className="text-odoo-text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {results.length > 0 ? (
            <div className="rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-[12px]">
              <span className="font-bold text-emerald-700">✓ {okCount}</span>
              <span className="ml-3 font-bold text-rose-700">✗ {errCount}</span>
              <span className="ml-3 text-odoo-text-muted">
                / {rows.length} ແຖວ
              </span>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-odoo-border bg-odoo-surface-muted px-5 py-3">
          <button
            type="button"
            onClick={done ? onDone : onClose}
            className="odoo-btn odoo-btn-secondary"
            disabled={importing}
          >
            {done ? "ປິດ" : "ຍົກເລີກ"}
          </button>
          <button
            type="button"
            onClick={runImport}
            disabled={importing || rows.length === 0 || done}
            className="odoo-btn odoo-btn-primary"
          >
            {importing
              ? `ກຳລັງນຳເຂົ້າ ${results.length}/${rows.length}`
              : `ນຳເຂົ້າ ${rows.length} ແຖວ`}
          </button>
        </footer>
      </div>
    </div>
  );
}
