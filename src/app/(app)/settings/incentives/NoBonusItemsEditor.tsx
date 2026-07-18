"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ExemptItem = { itemCode: string; itemName: string; note: string; statusCode: string; weight: number };
type Match = { itemCode: string; itemName: string };
type Payload = { items: ExemptItem[]; matches?: Match[]; error?: string };

// Manages the bonus-exempt product list (app_incentive_product_status rows with
// status special_no_bonus → multiplier 0, so their sales earn zero points).
export default function NoBonusItemsEditor({ canManage, year, month }: { canManage: boolean; year: number; month: number }) {
  const [items, setItems] = useState<ExemptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [note, setNote] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/no-bonus-items?year=${year}&month=${month}`, { cache: "no-store" });
      const body = (await res.json()) as Payload;
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setItems(body.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced product search against the item master for the add-picker.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/incentives/no-bonus-items?q=${encodeURIComponent(q)}&year=${year}&month=${month}`, { cache: "no-store" });
        const body = (await res.json()) as Payload;
        if (res.ok) setMatches(body.matches ?? []);
      } catch {
        /* search is best-effort */
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, year, month]);

  async function send(method: "PUT" | "DELETE", itemCode: string) {
    setBusy(itemCode);
    setError(null);
    try {
      const res = await fetch("/api/incentives/no-bonus-items", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode, note: note.trim(), year, month }),
      });
      const body = (await res.json()) as Payload;
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setItems(body.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  const exempt = new Set(items.filter((item) => item.statusCode === "special_no_bonus").map((i) => i.itemCode));
  const statusLabel = (item: ExemptItem) => item.statusCode === "special_no_bonus" ? "ບໍ່ຈ່າຍ" : item.statusCode === "special_min_bonus" ? "Min ×0.5" : item.statusCode === "special_promo_max" ? "Max ×1.2" : `×${item.weight}`;

  return (
    <section className="odoo-card incentive-editor incentive-editor--exclusions p-4">
      <div className="incentive-editor-head mb-3">
        <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">ສະຖານະສິນຄ້າ Min / Max / ບໍ່ຈ່າຍ</h2>
        <p className="text-xs text-odoo-text-muted">ສະເພາະເດືອນ {String(month).padStart(2, "0")}/{year} · ສິນຄ້າໃນລາຍການນີ້ມີຕົວຄູນ 0</p>
      </div>

      {error ? <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      {canManage ? (
        <div className="incentive-add-panel mb-4 rounded-md border border-odoo-border bg-odoo-surface-muted p-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_2fr]">
            <input
              placeholder="ຄົ້ນຫາ ລະຫັດ ຫຼື ຊື່ສິນຄ້າ…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="odoo-input"
            />
            <input
              placeholder="ໝາຍເຫດ (ທາງເລືອກ)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="odoo-input"
            />
          </div>
          {matches.length > 0 ? (
            <ul className="mt-2 max-h-56 divide-y divide-odoo-border overflow-y-auto rounded-md border border-odoo-border bg-white">
              {matches.map((m) => (
                <li key={m.itemCode} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono font-bold text-odoo-text-strong">{m.itemCode}</span>
                    <span className="ml-2 text-odoo-text-muted">{m.itemName}</span>
                  </span>
                  <button
                    type="button"
                    disabled={exempt.has(m.itemCode) || busy === m.itemCode}
                    onClick={() => void send("PUT", m.itemCode)}
                    className="odoo-btn odoo-btn-primary shrink-0 disabled:opacity-40"
                  >
                    {exempt.has(m.itemCode) ? "ຍົກເວັ້ນແລ້ວ" : "ຍົກເວັ້ນ"}
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 ? (
            <p className="mt-2 text-xs text-odoo-text-muted">ບໍ່ພົບສິນຄ້າ</p>
          ) : null}
        </div>
      ) : null}

      <div className="incentive-stats incentive-stats--compact">
        <div className="is-warning"><span>ສະຖານະພິເສດ</span><strong>{items.length}</strong><small>ລາຍການ</small></div>
      </div>

      <div className="incentive-table-wrap overflow-x-auto">
        <table className="odoo-table incentive-data-table min-w-[560px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລະຫັດ</th>
              <th className="px-3 py-2">ຊື່ສິນຄ້າ</th>
              <th className="px-3 py-2">ສະຖານະ</th>
              <th className="px-3 py-2">ໝາຍເຫດ</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີສະຖານະສິນຄ້າໃນເດືອນນີ້</td></tr>
            ) : items.map((item) => (
              <tr key={item.itemCode}>
                <td className="px-3 py-2 font-mono font-bold text-odoo-text-strong">{item.itemCode}</td>
                <td className="px-3 py-2">{item.itemName || <span className="text-odoo-text-muted">—</span>}</td>
                <td className="px-3 py-2 font-bold text-teal-700">{statusLabel(item)}</td>
                <td className="px-3 py-2 text-odoo-text-muted">{item.note || "—"}</td>
                {canManage && item.statusCode === "special_no_bonus" ? (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy === item.itemCode}
                      onClick={() => { if (confirm(`ເອົາ ${item.itemCode} ອອກຈາກລາຍການຍົກເວັ້ນ? ສິນຄ້ານີ້ຈະນັບຄະແນນຄືນ`)) void send("DELETE", item.itemCode); }}
                      className="odoo-btn text-odoo-danger disabled:opacity-40"
                    >ເອົາອອກ</button>
                  </td>
                ) : canManage ? <td /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
