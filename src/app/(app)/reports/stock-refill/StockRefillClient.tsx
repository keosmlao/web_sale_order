"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Warehouse = {
  code: string;
  name: string;
  isSalesWarehouse: boolean;
};

type WatchItem = {
  warehouseCode: string;
  warehouseName: string;
  itemCode: string;
  itemName: string;
  unitName: string | null;
  minQty: number;
  targetQty: number;
  currentStock: number;
  suggestedQty: number;
  status: "out" | "low" | "below_target" | "ok";
  openRequestId: string | null;
  openRequestStatus: string | null;
  openRequestQty: number | null;
};

type RefillRequest = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  itemCode: string;
  itemName: string;
  unitName: string | null;
  requestedQty: number;
  status: "pending" | "approved" | "rejected" | "fulfilled" | "cancelled";
  requestorCode: string;
  requestorName: string | null;
  approverCode: string | null;
  approverName: string | null;
  fulfillerCode: string | null;
  fulfillerName: string | null;
  reason: string | null;
  approverNote: string | null;
  refDocNo: string | null;
  snapshotStock: number | null;
  snapshotMin: number | null;
  snapshotTarget: number | null;
  requestedAt: string;
  decidedAt: string | null;
  fulfilledAt: string | null;
};

const qtyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default function StockRefillClient({
  canApprove,
  canCreate,
}: {
  canApprove: boolean;
  canCreate: boolean;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [filter, setFilter] = useState<"needs_refill" | "critical">("needs_refill");
  const [items, setItems] = useState<WatchItem[]>([]);
  const [requests, setRequests] = useState<RefillRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestModal, setRequestModal] = useState<WatchItem | null>(null);
  const [decideModal, setDecideModal] = useState<{
    request: RefillRequest;
    action: "approve" | "reject" | "fulfill" | "cancel";
  } | null>(null);

  const load = useCallback(
    async (wh = warehouseCode, st = filter) => {
      setError(null);
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (wh) params.set("warehouse", wh);
        if (st) params.set("status", st);
        const res = await fetch(`/api/reports/stock-refill?${params.toString()}`);
        if (!res.ok) throw new Error(`stock-refill ${res.status}`);
        const data = await res.json();
        setItems((data.items ?? []) as WatchItem[]);
        setRequests((data.requests ?? []) as RefillRequest[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
      } finally {
        setLoading(false);
      }
    },
    [warehouseCode, filter],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const whRes = await fetch("/api/settings/sales-warehouses");
        if (!whRes.ok) throw new Error(`warehouses ${whRes.status}`);
        const whData = await whRes.json();
        if (cancelled) return;
        const rows = ((whData.items ?? []) as Warehouse[]).filter(
          (r) => r.isSalesWarehouse,
        );
        setWarehouses(rows);
        const first = rows[0]?.code ?? "";
        setWarehouseCode(first);
        await load(first, filter);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusLabel = (s: WatchItem["status"]) => {
    if (s === "out") return "ບໍ່ມີ stock";
    if (s === "low") return "ຕ່ຳກວ່າ minimum";
    if (s === "below_target") return "ຕ່ຳກວ່າ target";
    return "ພໍຂາຍ";
  };

  const statusClass = (s: WatchItem["status"]) =>
    s === "out" || s === "low"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : s === "below_target"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";

  const requestStatusClass = (s: RefillRequest["status"]) =>
    s === "pending"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : s === "approved"
        ? "bg-sky-50 text-sky-700 border-sky-200"
        : s === "fulfilled"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : s === "rejected"
            ? "bg-rose-50 text-rose-700 border-rose-200"
            : "bg-slate-50 text-slate-600 border-slate-200";

  const requestStatusLabel = (s: RefillRequest["status"]) => {
    if (s === "pending") return "ລໍຖ້າອະນຸມັດ";
    if (s === "approved") return "ອະນຸມັດ — ລໍຖ້າເຕີມ";
    if (s === "fulfilled") return "ເຕີມສຳເລັດ";
    if (s === "rejected") return "ປະຕິເສດ";
    return "ຍົກເລີກ";
  };

  const summary = useMemo(() => {
    const out = items.filter((i) => i.status === "out").length;
    const low = items.filter((i) => i.status === "low").length;
    const below = items.filter((i) => i.status === "below_target").length;
    return { out, low, below };
  }, [items]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ລາຍງານສະຕ້ອກ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ຕິດຕາມ stock + ຂໍເຕີມສະຕ້ອກ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ສິນຄ້າທີ່ stock ຕ່ຳກວ່າ target — ກົດປຸ່ມ "ຂໍເຕີມ" ເພື່ອສ້າງຄຳຂໍ.
        </p>
      </header>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="ບໍ່ມີ stock" value={summary.out} tone="danger" />
        <KpiCard label="ຕ່ຳກວ່າ minimum" value={summary.low} tone="danger" />
        <KpiCard label="ຕ່ຳກວ່າ target" value={summary.below} tone="warning" />
        <KpiCard
          label="ຄຳຂໍຄ້າງ"
          value={requests.filter((r) => r.status === "pending").length}
          tone="info"
        />
      </div>

      {/* Filters */}
      <section className="mb-4 rounded-md border border-odoo-border bg-odoo-surface px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="odoo-label">ສາງ</span>
            <select
              value={warehouseCode}
              onChange={(e) => {
                const next = e.target.value;
                setWarehouseCode(next);
                void load(next, filter);
              }}
              className="odoo-input h-9 min-w-48"
            >
              <option value="">ທຸກສາງ</option>
              {warehouses.map((wh) => (
                <option key={wh.code} value={wh.code}>
                  {wh.code} · {wh.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="odoo-label">ກອງຕາມ</span>
            <select
              value={filter}
              onChange={(e) => {
                const next = e.target.value as "needs_refill" | "critical";
                setFilter(next);
                void load(warehouseCode, next);
              }}
              className="odoo-input h-9 min-w-48"
            >
              <option value="needs_refill">Stock ≤ Target</option>
              <option value="critical">Stock ≤ Minimum (ດ່ວນ)</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="odoo-btn odoo-btn-secondary h-9"
          >
            ໂຫລດໃໝ່
          </button>
          {error ? (
            <div className="odoo-alert-danger ml-auto px-3 py-1.5 text-xs">
              {error}
            </div>
          ) : null}
        </div>
      </section>

      {/* Watchlist */}
      <section className="mb-6 rounded-md border border-odoo-border bg-odoo-surface">
        <div className="border-b border-odoo-border px-4 py-3">
          <div className="text-sm font-bold text-odoo-text-strong">
            ສິນຄ້າທີ່ຕ້ອງເຕີມ ({items.length})
          </div>
          <div className="text-xs text-odoo-text-muted">
            ຈັດຮຽງຕາມຄວາມຮີບດ່ວນ (stock/target ນ້ອຍສຸດກ່ອນ).
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3">ສິນຄ້າ</th>
                <th className="px-4 py-3">ສາງ</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3 text-right">Min</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">ຂາດ</th>
                <th className="px-4 py-3">ສະຖານະ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-odoo-text-muted">
                    ກຳລັງໂຫລດ...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-odoo-text-muted">
                    ບໍ່ມີສິນຄ້າທີ່ຕ້ອງເຕີມ — stock ໝົດສະບາຍ
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={`${it.warehouseCode}-${it.itemCode}`}
                    className="border-t border-odoo-border"
                  >
                    <td className="px-4 py-3">
                      <div className="font-bold text-odoo-text-strong">{it.itemCode}</div>
                      <div className="text-xs text-odoo-text-muted">
                        {it.itemName} {it.unitName ? `· ${it.unitName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-semibold text-odoo-text-strong">{it.warehouseCode}</div>
                      <div className="text-odoo-text-muted">{it.warehouseName}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {qtyFmt.format(it.currentStock)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-odoo-text-muted">
                      {qtyFmt.format(it.minQty)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-odoo-text-muted">
                      {qtyFmt.format(it.targetQty)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-rose-700">
                      {qtyFmt.format(it.suggestedQty)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex rounded-full border px-2 py-1 text-xs font-bold " +
                          statusClass(it.status)
                        }
                      >
                        {statusLabel(it.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {it.openRequestId ? (
                        <span className="inline-flex rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-bold text-sky-700">
                          {it.openRequestStatus === "approved"
                            ? "ລໍຖ້າເຕີມ"
                            : "ລໍຖ້າອະນຸມັດ"}
                          {it.openRequestQty != null
                            ? ` · ${qtyFmt.format(it.openRequestQty)}`
                            : ""}
                        </span>
                      ) : canCreate ? (
                        <button
                          type="button"
                          onClick={() => setRequestModal(it)}
                          className="odoo-btn odoo-btn-primary text-xs"
                        >
                          ຂໍເຕີມ
                        </button>
                      ) : (
                        <span className="text-xs text-odoo-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Requests panel */}
      <section className="rounded-md border border-odoo-border bg-odoo-surface">
        <div className="border-b border-odoo-border px-4 py-3">
          <div className="text-sm font-bold text-odoo-text-strong">
            ຄຳຂໍເຕີມສະຕ້ອກ ({requests.length})
          </div>
          <div className="text-xs text-odoo-text-muted">
            pending → approved → fulfilled
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3">ສິນຄ້າ</th>
                <th className="px-4 py-3">ສາງ</th>
                <th className="px-4 py-3 text-right">ຈຳນວນ</th>
                <th className="px-4 py-3">ສະຖານະ</th>
                <th className="px-4 py-3">ຜູ້ຂໍ</th>
                <th className="px-4 py-3">ວັນທີ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-odoo-text-muted">
                    ຍັງບໍ່ມີຄຳຂໍ
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id} className="border-t border-odoo-border align-top">
                    <td className="px-4 py-3">
                      <div className="font-bold text-odoo-text-strong">{r.itemCode}</div>
                      <div className="text-xs text-odoo-text-muted">
                        {r.itemName} {r.unitName ? `· ${r.unitName}` : ""}
                      </div>
                      {r.reason ? (
                        <div className="mt-1 text-[11px] text-odoo-text-muted">
                          “{r.reason}”
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-odoo-text-muted">
                      {r.warehouseCode}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {qtyFmt.format(r.requestedQty)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex rounded-full border px-2 py-1 text-xs font-bold " +
                          requestStatusClass(r.status)
                        }
                      >
                        {requestStatusLabel(r.status)}
                      </span>
                      {r.approverNote ? (
                        <div className="mt-1 text-[11px] text-odoo-text-muted">
                          {r.approverNote}
                        </div>
                      ) : null}
                      {r.refDocNo ? (
                        <div className="mt-1 text-[11px] font-mono text-emerald-700">
                          ref: {r.refDocNo}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-semibold text-odoo-text-strong">
                        {r.requestorName ?? r.requestorCode}
                      </div>
                      {r.approverName ? (
                        <div className="text-odoo-text-muted">
                          ອະນຸ: {r.approverName}
                        </div>
                      ) : null}
                      {r.fulfillerName ? (
                        <div className="text-odoo-text-muted">
                          ເຕີມ: {r.fulfillerName}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-odoo-text-muted">
                      {dateFmt.format(new Date(r.requestedAt))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.status === "pending" && canApprove ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setDecideModal({ request: r, action: "approve" })}
                              className="odoo-btn odoo-btn-primary text-xs"
                            >
                              ອະນຸມັດ
                            </button>
                            <button
                              type="button"
                              onClick={() => setDecideModal({ request: r, action: "reject" })}
                              className="odoo-btn odoo-btn-danger text-xs"
                            >
                              ປະຕິເສດ
                            </button>
                          </>
                        ) : null}
                        {r.status === "approved" && canApprove ? (
                          <button
                            type="button"
                            onClick={() => setDecideModal({ request: r, action: "fulfill" })}
                            className="odoo-btn odoo-btn-primary text-xs"
                          >
                            ເຕີມສຳເລັດ
                          </button>
                        ) : null}
                        {r.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => setDecideModal({ request: r, action: "cancel" })}
                            className="odoo-btn odoo-btn-secondary text-xs"
                          >
                            ຍົກເລີກ
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {requestModal ? (
        <CreateRequestModal
          item={requestModal}
          onClose={() => setRequestModal(null)}
          onDone={() => {
            setRequestModal(null);
            void load();
          }}
        />
      ) : null}

      {decideModal ? (
        <DecideModal
          request={decideModal.request}
          action={decideModal.action}
          onClose={() => setDecideModal(null)}
          onDone={() => {
            setDecideModal(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "warning" | "info" | "success";
}) {
  const cls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "info"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700";
  return (
    <div className={"rounded-md border px-4 py-3 " + cls}>
      <div className="text-[11px] font-bold uppercase tracking-widest opacity-80">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-black">{value}</div>
    </div>
  );
}

function CreateRequestModal({
  item,
  onClose,
  onDone,
}: {
  item: WatchItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState(String(Math.max(1, Math.ceil(item.suggestedQty))));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/stock-refill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseCode: item.warehouseCode,
          itemCode: item.itemCode,
          requestedQty: Number(qty),
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ສ້າງຄຳຂໍບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="ຂໍເຕີມສະຕ້ອກ" onClose={onClose}>
      <div className="grid gap-3">
        <div className="rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-sm">
          <div className="font-bold text-odoo-text-strong">{item.itemCode}</div>
          <div className="text-xs text-odoo-text-muted">{item.itemName}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-odoo-text-muted">Stock</div>
              <div className="font-mono font-bold">{item.currentStock}</div>
            </div>
            <div>
              <div className="text-odoo-text-muted">Min</div>
              <div className="font-mono">{item.minQty}</div>
            </div>
            <div>
              <div className="text-odoo-text-muted">Target</div>
              <div className="font-mono">{item.targetQty}</div>
            </div>
          </div>
        </div>
        <label className="grid gap-1">
          <span className="odoo-label">ຈຳນວນທີ່ຂໍ</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="odoo-input"
          />
          <span className="text-[11px] text-odoo-text-muted">
            ແນະນຳ: {item.suggestedQty} (target − stock)
          </span>
        </label>
        <label className="grid gap-1">
          <span className="odoo-label">ເຫດຜົນ (ບໍ່ບັງຄັບ)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="odoo-input"
            placeholder="ຕົວຢ່າງ: ມີ promo ໃນວັນທີ..."
          />
        </label>
        {error ? (
          <div className="odoo-alert-danger px-3 py-2 text-sm">{error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
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
            onClick={submit}
            disabled={saving || !qty || Number(qty) <= 0}
            className="odoo-btn odoo-btn-primary"
          >
            {saving ? "ກຳລັງສົ່ງ..." : "ສົ່ງຄຳຂໍ"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function DecideModal({
  request,
  action,
  onClose,
  onDone,
}: {
  request: RefillRequest;
  action: "approve" | "reject" | "fulfill" | "cancel";
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [refDocNo, setRefDocNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleMap = {
    approve: "ອະນຸມັດຄຳຂໍ",
    reject: "ປະຕິເສດຄຳຂໍ",
    fulfill: "ໝາຍວ່າເຕີມສຳເລັດ",
    cancel: "ຍົກເລີກຄຳຂໍ",
  };
  const primaryLabel = {
    approve: "ອະນຸມັດ",
    reject: "ປະຕິເສດ",
    fulfill: "ບັນທຶກ",
    cancel: "ຍົກເລີກຄຳຂໍ",
  };

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/stock-refill/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: note.trim() || undefined,
          refDocNo: action === "fulfill" ? refDocNo.trim() || undefined : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={titleMap[action]} onClose={onClose}>
      <div className="grid gap-3">
        <div className="rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-sm">
          <div className="font-bold text-odoo-text-strong">
            {request.itemCode} · {qtyFmt.format(request.requestedQty)}
            {request.unitName ? ` ${request.unitName}` : ""}
          </div>
          <div className="text-xs text-odoo-text-muted">
            {request.itemName} · {request.warehouseCode}
          </div>
          {request.reason ? (
            <div className="mt-1 text-xs text-odoo-text-muted">
              ເຫດຜົນ: “{request.reason}”
            </div>
          ) : null}
        </div>
        {action === "fulfill" ? (
          <label className="grid gap-1">
            <span className="odoo-label">ເລກອ້າງອີງ (ໃບໂອນ/PO)</span>
            <input
              value={refDocNo}
              onChange={(e) => setRefDocNo(e.target.value)}
              className="odoo-input"
              placeholder="ຕົວຢ່າງ: TRF26050123"
            />
          </label>
        ) : null}
        <label className="grid gap-1">
          <span className="odoo-label">ໝາຍເຫດ</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="odoo-input"
            placeholder={action === "reject" ? "ເຫດຜົນທີ່ປະຕິເສດ..." : ""}
          />
        </label>
        {error ? (
          <div className="odoo-alert-danger px-3 py-2 text-sm">{error}</div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="odoo-btn odoo-btn-secondary"
            disabled={saving}
          >
            ປິດ
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className={
              "odoo-btn " +
              (action === "reject" || action === "cancel"
                ? "odoo-btn-danger"
                : "odoo-btn-primary")
            }
          >
            {saving ? "ກຳລັງບັນທຶກ..." : primaryLabel[action]}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border px-5 py-4">
          <h2 className="text-base font-bold text-odoo-text-strong">{title}</h2>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
