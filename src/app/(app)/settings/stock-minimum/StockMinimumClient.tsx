"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Warehouse = {
  code: string;
  name: string;
  isSalesWarehouse: boolean;
};

type ItemOption = {
  code: string;
  name: string;
  unitName: string | null;
};

type StockRule = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  itemCode: string;
  itemName: string;
  unitName: string | null;
  minQty: number;
  targetQty: number;
  dailySalesQty: number;
  coverDays: number;
  safetyQty: number;
  currentStock: number;
  shortageQty: number;
  status: "ok" | "below_target" | "low" | "out";
  note: string | null;
  updatedAt: string;
};

const qtyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export default function StockMinimumClient({
  canManage,
}: {
  canManage: boolean;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [rules, setRules] = useState<StockRule[]>([]);
  const [q, setQ] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [item, setItem] = useState<ItemOption | null>(null);
  const [dailySalesQty, setDailySalesQty] = useState("0");
  const [coverDays, setCoverDays] = useState("3");
  const [safetyQty, setSafetyQty] = useState("0");
  const [minQty, setMinQty] = useState("");
  const [targetQty, setTargetQty] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculatedMin = useMemo(() => {
    const daily = Number(dailySalesQty);
    const days = Number(coverDays);
    const safety = Number(safetyQty);
    if (!Number.isFinite(daily) || !Number.isFinite(days) || !Number.isFinite(safety)) {
      return 0;
    }
    return Math.max(0, daily * days + safety);
  }, [dailySalesQty, coverDays, safetyQty]);

  async function loadRules(nextWarehouse = warehouseCode, nextQ = q) {
    const params = new URLSearchParams();
    if (nextWarehouse) params.set("warehouse", nextWarehouse);
    if (nextQ.trim()) params.set("q", nextQ.trim());
    const res = await fetch(`/api/settings/stock-minimum?${params.toString()}`);
    if (!res.ok) throw new Error(`minimum-stock ${res.status}`);
    const data = await res.json();
    setRules((data.items ?? []) as StockRule[]);
  }

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
          (row) => row.isSalesWarehouse,
        );
        setWarehouses(rows);
        const first = rows[0]?.code ?? "";
        setWarehouseCode(first);
        const params = first ? `?warehouse=${encodeURIComponent(first)}` : "";
        const rulesRes = await fetch(`/api/settings/stock-minimum${params}`);
        if (!rulesRes.ok) throw new Error(`minimum-stock ${rulesRes.status}`);
        const rulesData = await rulesRes.json();
        if (!cancelled) setRules((rulesData.items ?? []) as StockRule[]);
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!itemQuery.trim()) {
            setItemOptions([]);
            return;
          }
          const params = new URLSearchParams({
            q: itemQuery.trim(),
            limit: "12",
          });
          const res = await fetch(`/api/inventory/search?${params.toString()}`);
          if (!res.ok) throw new Error(`items ${res.status}`);
          const data = await res.json();
          if (!cancelled) setItemOptions((data ?? []) as ItemOption[]);
        } catch {
          if (!cancelled) setItemOptions([]);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [itemQuery]);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!canManage || saving || !warehouseCode || !item) return;
    setSaving(true);
    setError(null);
    try {
      const min = minQty.trim() ? Number(minQty) : calculatedMin;
      const target = targetQty.trim() ? Number(targetQty) : Math.max(min, calculatedMin);
      const res = await fetch("/api/settings/stock-minimum", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseCode,
          itemCode: item.code,
          dailySalesQty: Number(dailySalesQty),
          coverDays: Number(coverDays),
          safetyQty: Number(safetyQty),
          minQty: min,
          targetQty: target,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ບັນທຶກຜິດພາດ ${res.status}`);
        return;
      }
      setItem(null);
      setItemQuery("");
      setMinQty("");
      setTargetQty("");
      setNote("");
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: StockRule) {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        warehouseCode: rule.warehouseCode,
        itemCode: rule.itemCode,
      });
      const res = await fetch(`/api/settings/stock-minimum?${params.toString()}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ລຶບຜິດພາດ ${res.status}`);
        return;
      }
      await loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ລຶບບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = (rule: StockRule) => {
    if (rule.status === "out") return "ບໍ່ມີ stock";
    if (rule.status === "low") return "ຕ່ຳກວ່າ minimum";
    if (rule.status === "below_target") return "ຕ່ຳກວ່າ target";
    return "ພໍຂາຍ";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          Minimum Stock
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ກຳນົດຈຸດ stock ຕ່ຳສຸດຕາມສາງຂາຍ ແລະ ສິນຄ້າ.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section className="rounded-md border border-odoo-border bg-odoo-surface">
          <div className="border-b border-odoo-border px-4 py-3">
            <div className="text-sm font-bold text-odoo-text-strong">
              ເພີ່ມ/ແກ້ໄຂ minimum
            </div>
          </div>
          <div className="grid gap-3 px-4 py-4">
            <label className="grid gap-1">
              <span className="odoo-label">ສາງຂາຍ</span>
              <select
                value={warehouseCode}
                onChange={(e) => {
                  const next = e.target.value;
                  setWarehouseCode(next);
                  void loadRules(next, q);
                }}
                className="odoo-input"
                disabled={saving}
              >
                {warehouses.map((wh) => (
                  <option key={wh.code} value={wh.code}>
                    {wh.code} · {wh.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="odoo-label">ສິນຄ້າ</span>
              <input
                value={itemQuery}
                onChange={(e) => {
                  setItemQuery(e.target.value);
                  setItem(null);
                }}
                className="odoo-input"
                placeholder="ຄົ້ນລະຫັດ ຫຼື ຊື່ສິນຄ້າ"
                disabled={!canManage || saving}
              />
              {item ? (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {item.code} · {item.name}
                </div>
              ) : itemOptions.length > 0 ? (
                <div className="max-h-56 overflow-y-auto rounded-md border border-odoo-border bg-white shadow-sm">
                  {itemOptions.map((opt) => (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => {
                        setItem(opt);
                        setItemQuery(`${opt.code} · ${opt.name}`);
                        setItemOptions([]);
                      }}
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-odoo-surface-muted"
                    >
                      <span className="font-bold text-odoo-text-strong">{opt.code}</span>
                      <span className="text-odoo-text-muted"> · {opt.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1">
                <span className="odoo-label">ຂາຍ/ວັນ</span>
                <input
                  type="number"
                  min={0}
                  value={dailySalesQty}
                  onChange={(e) => setDailySalesQty(e.target.value)}
                  className="odoo-input"
                  disabled={!canManage || saving}
                />
              </label>
              <label className="grid gap-1">
                <span className="odoo-label">ກັນຈັກມື້</span>
                <input
                  type="number"
                  min={0}
                  value={coverDays}
                  onChange={(e) => setCoverDays(e.target.value)}
                  className="odoo-input"
                  disabled={!canManage || saving}
                />
              </label>
              <label className="grid gap-1">
                <span className="odoo-label">Safety</span>
                <input
                  type="number"
                  min={0}
                  value={safetyQty}
                  onChange={(e) => setSafetyQty(e.target.value)}
                  className="odoo-input"
                  disabled={!canManage || saving}
                />
              </label>
            </div>
            <div className="rounded-md bg-odoo-primary-50 px-3 py-2 text-xs font-semibold text-odoo-primary">
              ຄຳນວນ minimum: {qtyFmt.format(calculatedMin)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="odoo-label">Minimum</span>
                <input
                  type="number"
                  min={0}
                  value={minQty}
                  onChange={(e) => setMinQty(e.target.value)}
                  className="odoo-input"
                  placeholder={String(calculatedMin)}
                  disabled={!canManage || saving}
                />
              </label>
              <label className="grid gap-1">
                <span className="odoo-label">Target</span>
                <input
                  type="number"
                  min={0}
                  value={targetQty}
                  onChange={(e) => setTargetQty(e.target.value)}
                  className="odoo-input"
                  disabled={!canManage || saving}
                />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="odoo-label">ໝາຍເຫດ</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="odoo-input"
                disabled={!canManage || saving}
              />
            </label>
            <button
              type="button"
              onClick={save}
              disabled={!canManage || saving || !item || !warehouseCode}
              className="odoo-btn odoo-btn-primary justify-center"
            >
              {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ minimum"}
            </button>
            {error ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
                {error}
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-md border border-odoo-border bg-odoo-surface">
          <div className="flex flex-col gap-3 border-b border-odoo-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-bold text-odoo-text-strong">
                ລາຍການ minimum stock
              </div>
              <div className="text-xs text-odoo-text-muted">
                ສີແດງແມ່ນຕ່ຳກວ່າ minimum ຕ້ອງໂອນ/ສັ່ງເພີ່ມ.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setImporting(true)}
                  className="odoo-btn odoo-btn-secondary"
                >
                  Import Excel
                </button>
              ) : null}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="odoo-input h-9 w-56"
                placeholder="ຄົ້ນຫາ"
              />
              <button type="button" onClick={refresh} className="odoo-btn odoo-btn-secondary">
                ຄົ້ນ
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
                <tr>
                  <th className="px-4 py-3">ສິນຄ້າ</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Minimum</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">ສະຖານະ</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-odoo-text-muted">
                      ກຳລັງໂຫລດ...
                    </td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-odoo-text-muted">
                      ຍັງບໍ່ມີການກຳນົດ minimum stock
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr key={rule.id} className="border-t border-odoo-border">
                      <td className="px-4 py-3">
                        <div className="font-bold text-odoo-text-strong">{rule.itemCode}</div>
                        <div className="text-xs text-odoo-text-muted">
                          {rule.itemName} {rule.unitName ? `· ${rule.unitName}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {qtyFmt.format(rule.currentStock)}
                      </td>
                      <td className="px-4 py-3">{qtyFmt.format(rule.minQty)}</td>
                      <td className="px-4 py-3">{qtyFmt.format(rule.targetQty)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            "inline-flex rounded-full px-2 py-1 text-xs font-bold " +
                            (rule.status === "low" || rule.status === "out"
                              ? "bg-rose-50 text-rose-700"
                              : rule.status === "below_target"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700")
                          }
                        >
                          {statusLabel(rule)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => remove(rule)}
                          disabled={!canManage || saving}
                          className="odoo-btn odoo-btn-secondary text-xs"
                        >
                          ລຶບ
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {importing ? (
        <ImportStockMinimumModal
          defaultWarehouseCode={warehouseCode}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            void loadRules();
          }}
        />
      ) : null}
    </div>
  );
}

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
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

// Columns the importer reads. Templates include extra display columns
// (itemName, brand, category, currentStock) that are ignored on import.
const IMPORT_COLUMNS = [
  "warehouseCode",
  "itemCode",
  "dailySalesQty",
  "coverDays",
  "safetyQty",
  "minQty",
  "targetQty",
  "note",
] as const;

const TEMPLATE_COLUMNS = [
  "warehouseCode",
  "itemCode",
  "itemName",
  "brand",
  "category",
  "currentStock",
  "dailySalesQty",
  "coverDays",
  "safetyQty",
  "minQty",
  "targetQty",
  "note",
] as const;

type ImportResult = {
  rowNumber: number;
  itemCode: string;
  status: "ok" | "error";
  error?: string;
};

function parseNumber(raw: string, fallback = 0) {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function rowToPayload(row: Record<string, string>, defaultWarehouseCode: string) {
  const dailySalesQty = parseNumber(row.dailySalesQty ?? "");
  const coverDays = parseNumber(row.coverDays ?? "");
  const safetyQty = parseNumber(row.safetyQty ?? "");
  const calculatedMin = dailySalesQty * coverDays + safetyQty;
  const minQty = row.minQty?.trim()
    ? parseNumber(row.minQty, calculatedMin)
    : calculatedMin;
  return {
    warehouseCode: row.warehouseCode?.trim() || defaultWarehouseCode,
    itemCode: row.itemCode?.trim() || "",
    dailySalesQty,
    coverDays,
    safetyQty,
    minQty,
    targetQty: row.targetQty?.trim()
      ? parseNumber(row.targetQty, minQty)
      : Math.max(minQty, calculatedMin),
    note: row.note?.trim() || undefined,
  };
}

function ImportStockMinimumModal({
  defaultWarehouseCode,
  onClose,
  onDone,
}: {
  defaultWarehouseCode: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function downloadTemplate() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const balanceUrl = defaultWarehouseCode
        ? `/api/inventory/sales-balances?warehouses=${encodeURIComponent(defaultWarehouseCode)}`
        : "/api/inventory/sales-balances";
      const [invRes, balRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch(balanceUrl),
      ]);
      if (!invRes.ok) throw new Error(`inventory ${invRes.status}`);
      if (!balRes.ok) throw new Error(`balances ${balRes.status}`);
      const invData = await invRes.json();
      const balData = await balRes.json();

      const balanceMap = new Map<string, number>();
      for (const b of (balData.items ?? []) as Array<{
        code: string | null;
        salesBalance: number | null;
      }>) {
        if (b.code) balanceMap.set(b.code, Number(b.salesBalance) || 0);
      }

      type InvItem = {
        code: string;
        nameLo: string | null;
        brand: string | null;
        brandName: string | null;
        category: string | null;
        categoryName: string | null;
        status: number | null;
      };
      // Only include items currently in stock at the selected warehouse.
      // Items with zero balance don't need a minimum-stock rule yet.
      const items = ((invData.items ?? []) as InvItem[]).filter(
        (it) =>
          it.code &&
          (it.status ?? 0) !== 1 &&
          (balanceMap.get(it.code) ?? 0) > 0,
      );
      // Sort by current stock DESC so high-stock items appear first.
      items.sort(
        (a, b) =>
          (balanceMap.get(b.code) ?? 0) - (balanceMap.get(a.code) ?? 0) ||
          a.code.localeCompare(b.code),
      );

      const body: (string | number)[][] = items.map((it) => [
        defaultWarehouseCode,
        it.code,
        it.nameLo ?? "",
        it.brand ? (it.brandName ? `${it.brand} · ${it.brandName}` : it.brand) : "",
        it.category
          ? it.categoryName
            ? `${it.category} · ${it.categoryName}`
            : it.category
          : "",
        balanceMap.get(it.code) ?? 0,
        "",
        "",
        "",
        "",
        "",
        "",
      ]);

      const data: (string | number)[][] =
        body.length > 0
          ? [[...TEMPLATE_COLUMNS], ...body]
          : [
              [...TEMPLATE_COLUMNS],
              [defaultWarehouseCode, "110101-0001", "ຕົວຢ່າງສິນຄ້າ", "", "", 0, 5, 3, 2, "", 25, ""],
            ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = [
        { wch: 12 }, // warehouseCode
        { wch: 16 }, // itemCode
        { wch: 36 }, // itemName
        { wch: 22 }, // brand
        { wch: 22 }, // category
        { wch: 12 }, // currentStock
        { wch: 12 }, // dailySalesQty
        { wch: 10 }, // coverDays
        { wch: 10 }, // safetyQty
        { wch: 10 }, // minQty
        { wch: 10 }, // targetQty
        { wch: 20 }, // note
      ];
      ws["!freeze"] = { xSplit: 0, ySplit: 1 };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "stock-minimum");
      const stamp = new Date().toISOString().slice(0, 10);
      const fileSuffix = defaultWarehouseCode ? `-${defaultWarehouseCode}` : "";
      XLSX.writeFile(wb, `stock-minimum${fileSuffix}-${stamp}.xlsx`);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : "ໂຫລດ template ບໍ່ສຳເລັດ",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setResults([]);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const isCsv = /\.csv$/i.test(file.name);
    let headers: string[] = [];
    let rowsAoa: (string | number | null)[][] = [];

    if (isCsv) {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const parsed = parseCSV(text);
      headers = (parsed[0] ?? []).map((h) => h.trim());
      rowsAoa = parsed.slice(1);
    } else {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        setParseError("Excel file has no sheet");
        setRows([]);
        return;
      }
      const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(
        wb.Sheets[sheetName],
        { header: 1, defval: "", raw: false },
      );
      headers = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
      rowsAoa = aoa.slice(1);
    }

    const missingCols = IMPORT_COLUMNS.filter((c) => !headers.includes(c));
    if (missingCols.length > 0) {
      setParseError(`Missing columns: ${missingCols.join(", ")}`);
      setRows([]);
      return;
    }

    const nextRows: Record<string, string>[] = [];
    for (const row of rowsAoa) {
      const cells = row.map((c) => String(c ?? "").trim());
      if (cells.every((c) => c === "")) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, j) => {
        obj[h] = cells[j] ?? "";
      });
      nextRows.push(obj);
    }
    setRows(nextRows);
  }

  async function runImport() {
    if (importing || rows.length === 0) return;
    setImporting(true);
    const nextResults: ImportResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const payload = rowToPayload(rows[i], defaultWarehouseCode);
      try {
        if (!payload.warehouseCode || !payload.itemCode) {
          throw new Error("warehouseCode and itemCode are required");
        }
        const res = await fetch("/api/settings/stock-minimum", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          nextResults.push({
            rowNumber: i + 2,
            itemCode: payload.itemCode,
            status: "ok",
          });
        } else {
          const data = await res.json().catch(() => null);
          nextResults.push({
            rowNumber: i + 2,
            itemCode: payload.itemCode,
            status: "error",
            error: data?.error ?? `HTTP ${res.status}`,
          });
        }
      } catch (err) {
        nextResults.push({
          rowNumber: i + 2,
          itemCode: payload.itemCode,
          status: "error",
          error: err instanceof Error ? err.message : "Network error",
        });
      }
      setResults([...nextResults]);
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
        aria-label="Close"
        className="absolute inset-0 cursor-default"
        onClick={done ? onDone : onClose}
      />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border px-5 py-4">
          <h2 className="text-lg font-bold text-odoo-text-strong">
            Import Minimum Stock from Excel
          </h2>
          <p className="mt-1 text-xs text-odoo-text-muted">
            Download the template, fill it in Excel, then upload .xlsx, .xls, or .csv.
          </p>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={downloading}
              className="odoo-btn odoo-btn-secondary"
            >
              {downloading ? "ກຳລັງດຶງ..." : "Download template"}
            </button>
            <label className="odoo-btn odoo-btn-secondary cursor-pointer">
              Choose Excel file
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

          {downloadError ? (
            <div className="odoo-alert-danger mb-3 px-3 py-2 text-sm">
              {downloadError}
            </div>
          ) : null}

          {parseError ? (
            <div className="odoo-alert-danger mb-3 px-3 py-2 text-sm">
              {parseError}
            </div>
          ) : null}

          {rows.length > 0 ? (
            <>
              <div className="mb-2 text-[12px] font-bold text-odoo-text-strong">
                Preview ({rows.length} rows)
              </div>
              <div className="mb-4 max-h-72 overflow-auto rounded-md border border-odoo-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-odoo-surface-muted text-odoo-text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Warehouse</th>
                      <th className="px-2 py-1 text-left">Item</th>
                      <th className="px-2 py-1 text-left">Min</th>
                      <th className="px-2 py-1 text-left">Target</th>
                      <th className="px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const payload = rowToPayload(row, defaultWarehouseCode);
                      const res = results[idx];
                      return (
                        <tr key={idx} className="border-t border-odoo-border align-top">
                          <td className="px-2 py-1 font-mono text-odoo-text-muted">
                            {idx + 2}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {payload.warehouseCode}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {payload.itemCode}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {qtyFmt.format(payload.minQty)}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {qtyFmt.format(payload.targetQty)}
                          </td>
                          <td className="px-2 py-1">
                            {res ? (
                              res.status === "ok" ? (
                                <span className="text-emerald-700">OK</span>
                              ) : (
                                <span className="text-rose-700">{res.error}</span>
                              )
                            ) : (
                              <span className="text-odoo-text-muted">-</span>
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
              <span className="font-bold text-emerald-700">OK {okCount}</span>
              <span className="ml-3 font-bold text-rose-700">Error {errCount}</span>
              <span className="ml-3 text-odoo-text-muted">/ {rows.length} rows</span>
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
            {done ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={runImport}
            disabled={importing || rows.length === 0 || done}
            className="odoo-btn odoo-btn-primary"
          >
            {importing
              ? `Importing ${results.length}/${rows.length}`
              : `Import ${rows.length} rows`}
          </button>
        </footer>
      </div>
    </div>
  );
}
