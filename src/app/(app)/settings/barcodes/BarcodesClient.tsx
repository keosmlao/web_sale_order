"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  barcode: string;
  icCode: string;
  itemName: string | null;
  unitName: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

type SearchResult = {
  code: string;
  name: string | null;
  nameLo: string | null;
  unitName: string | null;
};

export default function BarcodesClient({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [newBarcode, setNewBarcode] = useState("");
  const [newItemQuery, setNewItemQuery] = useState("");
  const [newItem, setNewItem] = useState<SearchResult | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/inventory/barcode/admin?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setRows(data.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    Promise.resolve().then(() => {
      void fetchRows();
    });
  }, [fetchRows]);

  // Search items as the admin types in the item query box.
  useEffect(() => {
    if (!searchOpen) return;
    const term = newItemQuery.trim();
    let abort = false;
    const id = window.setTimeout(async () => {
      try {
        const url = `/api/inventory/search?${term ? `q=${encodeURIComponent(term)}` : ""}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!abort) {
          // Normalise into the shape we render.
          type Raw = {
            code?: string;
            name?: string;
            nameLo?: string;
            unitName?: string;
          };
          const items = (data.items ?? data.rows ?? []) as Raw[];
          setSearchResults(
            items.slice(0, 25).map((it) => ({
              code: it.code ?? "",
              name: it.name ?? null,
              nameLo: it.nameLo ?? null,
              unitName: it.unitName ?? null,
            })),
          );
        }
      } catch {
        // ignore
      }
    }, 200);
    return () => {
      abort = true;
      window.clearTimeout(id);
    };
  }, [newItemQuery, searchOpen]);

  async function addBarcode() {
    if (!canManage) return;
    if (!newBarcode.trim() || !newItem) {
      setError("ໃສ່ barcode + ເລືອກສິນຄ້າ");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/barcode/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: newBarcode.trim(),
          icCode: newItem.code,
          note: newNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      setNewBarcode("");
      setNewItemQuery("");
      setNewItem(null);
      setNewNote("");
      setSearchOpen(false);
      await fetchRows();
    } finally {
      setBusy(false);
    }
  }

  async function deleteBarcode(barcode: string) {
    if (!canManage) return;
    if (!window.confirm(`ລົບ barcode "${barcode}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/inventory/barcode/admin?barcode=${encodeURIComponent(barcode)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      await fetchRows();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          Barcode ສິນຄ້າ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ຈັບຄູ່ barcode (EAN/UPC ຫຼື ລະຫັດທີ່ພິມຕິດສິນຄ້າ) ກັບ ic_inventory.
          ໃຊ້ສຳລັບການສະແກນທີ່ໜ້າຮ້ານ.
        </p>
      </header>

      {!canManage ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          ສະຖານະອ່ານຢ່າງດຽວ — ສະເພາະຫົວໜ້າ / ຜູ້ຈັດການ ສາມາດແກ້ໄຂໄດ້
        </div>
      ) : null}

      {canManage ? (
        <div className="mb-4 rounded-md border border-odoo-border bg-odoo-surface p-4">
          <div className="text-sm font-bold text-odoo-text-strong">
            ເພີ່ມ barcode ໃໝ່
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1">
              <span className="odoo-label">Barcode (ສະແກນ ຫຼື ພິມ)</span>
              <input
                type="text"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
                placeholder="4901234567890"
                disabled={busy}
                className="odoo-input"
                autoComplete="off"
              />
            </label>
            <label className="relative grid gap-1">
              <span className="odoo-label">ສິນຄ້າ</span>
              <input
                type="text"
                value={newItem ? `${newItem.code} — ${newItem.name ?? ""}` : newItemQuery}
                onChange={(e) => {
                  setNewItem(null);
                  setNewItemQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="ຄົ້ນດ້ວຍລະຫັດ ຫຼື ຊື່"
                disabled={busy}
                className="odoo-input"
                autoComplete="off"
              />
              {searchOpen && searchResults.length > 0 ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-odoo-border bg-odoo-surface shadow-lg">
                  {searchResults.map((r) => (
                    <button
                      type="button"
                      key={r.code}
                      onClick={() => {
                        setNewItem(r);
                        setNewItemQuery("");
                        setSearchOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-odoo-surface-muted"
                    >
                      <span className="font-mono text-[11px] text-odoo-text-muted">
                        {r.code}
                      </span>
                      <span className="ml-2 text-odoo-text-strong">
                        {r.nameLo ?? r.name ?? "—"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
            <label className="grid gap-1">
              <span className="odoo-label">ໝາຍເຫດ (optional)</span>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                disabled={busy}
                className="odoo-input"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              onClick={addBarcode}
              disabled={busy || !newBarcode || !newItem}
              className="odoo-btn odoo-btn-primary w-full sm:w-auto"
            >
              ເພີ່ມ
            </button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ຄົ້ນ barcode / ລະຫັດສິນຄ້າ / ຊື່"
          className="odoo-input w-full sm:w-auto sm:flex-1"
        />
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface">
        <table className="min-w-[500px] w-full text-sm">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">Barcode</th>
              <th className="px-3 py-2">ສິນຄ້າ</th>
              <th className="px-3 py-2">ໝາຍເຫດ</th>
              <th className="px-3 py-2">ສ້າງເມື່ອ</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-odoo-text-muted"
                >
                  ກຳລັງໂຫລດ…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-odoo-text-muted"
                >
                  ບໍ່ມີ barcode
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.barcode}
                  className="border-t border-odoo-border hover:bg-odoo-surface-muted/50"
                >
                  <td className="px-3 py-2 font-mono text-[13px] font-bold">
                    {r.barcode}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-[11px] text-odoo-text-muted">
                      {r.icCode}
                    </div>
                    <div className="text-odoo-text-strong">
                      {r.itemName ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.note ?? ""}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-odoo-text-muted">
                    {new Date(r.createdAt).toLocaleDateString()}
                    {r.createdBy ? ` · ${r.createdBy}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => deleteBarcode(r.barcode)}
                        disabled={busy}
                        className="odoo-btn odoo-btn-danger"
                      >
                        ລົບ
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
