"use client";

import { useCallback, useEffect, useState } from "react";

// Product-category master (app_incentive_category): each item category_code maps
// to a bonus point group (pointmap_category) and a commission group (CE_SDA/AIR).
type Category = {
  categoryCode: string;
  categoryName: string;
  pointmapCategory: string;
  groupCode: string;
  weight: number;
  sdaSubtype: string;
  isActive: boolean;
};

const GROUPS = ["CE_SDA", "AIR"];
const SDA_SUBTYPES = ["AIRP", "DISP", "MW", "OTH", "WH"];

const emptyDraft = {
  categoryCode: "",
  categoryName: "",
  pointmapCategory: "",
  groupCode: "CE_SDA",
  weight: "1",
  sdaSubtype: "",
};

export default function CategoryEditor({
  canManage,
  pointmapVersion = 0,
}: {
  canManage: boolean;
  // Bumped by the Point-Categories editor so this dropdown refetches its options.
  pointmapVersion?: number;
}) {
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [pointmaps, setPointmaps] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/incentives/categories", { cache: "no-store" });
      const body = (await res.json()) as { categories: Category[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRows(body.categories);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Point-category options come from the master list; refetch when it changes.
  useEffect(() => {
    fetch("/api/incentives/pointmap-categories", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { categories: [] }))
      .then((body: { categories?: Array<{ code: string; isActive: boolean }> }) =>
        setPointmaps((body.categories ?? []).filter((c) => c.isActive).map((c) => c.code)))
      .catch(() => setPointmaps([]));
  }, [pointmapVersion]);

  // The dropdown options for a given row/draft — active master categories plus
  // the current value if it isn't in the list (so an existing value is never lost).
  const pointmapOptions = (current: string) => {
    const opts = [...pointmaps];
    if (current && !opts.includes(current)) opts.unshift(current);
    return opts;
  };

  const patch = (code: string, changes: Partial<Category>) =>
    setRows((prev) => prev.map((r) => (r.categoryCode === code ? { ...r, ...changes } : r)));

  async function send(method: "PUT" | "POST", payload: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch("/api/incentives/categories", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { categories: Category[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRows(body.categories);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove(code: string) {
    if (!window.confirm(`ລຶບໝວດ ${code}?`)) return;
    setBusy(code);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/categories?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { categories: Category[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRows(body.categories);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const ok = await send("POST", { ...draft, weight: Number(draft.weight) || 0 }, "__new__");
    if (ok) setDraft(emptyDraft);
  }

  return (
    <section className="odoo-card incentive-editor incentive-editor--categories p-4">
      <div className="incentive-editor-head mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">ໝວດສິນຄ້າ (Category Map)</h2>
          <p className="text-xs text-odoo-text-muted">ໝວດສິນຄ້າ → ໝວດຄະແນນ (pointmap) ແລະ ກຸ່ມຄ່າຄອມ (CE_SDA/AIR)</p>
        </div>
        <button type="button" onClick={() => void load()} className="odoo-btn">ໂຫລດໃໝ່</button>
      </div>

      {error ? <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      <div className="incentive-stats incentive-stats--compact">
        <div><span>ໝວດທັງໝົດ</span><strong>{rows.length}</strong><small>ໝວດ</small></div>
        <div className="is-accent"><span>ໃຊ້ງານ</span><strong>{rows.filter((r) => r.isActive).length}</strong><small>ໝວດ</small></div>
      </div>

      <datalist id="cat-sda">{SDA_SUBTYPES.map((v) => <option key={v} value={v} />)}</datalist>

      <div className="incentive-table-wrap overflow-x-auto">
        <table className="odoo-table incentive-data-table min-w-[880px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລະຫັດ</th>
              <th className="px-3 py-2">ຊື່ໝວດ</th>
              <th className="px-3 py-2">ໝວດຄະແນນ</th>
              <th className="px-3 py-2">ກຸ່ມ</th>
              <th className="px-3 py-2 text-right">ນ້ຳໜັກ</th>
              <th className="px-3 py-2">SDA subtype</th>
              <th className="px-3 py-2 text-center">ໃຊ້ງານ</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 8 : 7} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canManage ? 8 : 7} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
            ) : rows.map((r) => (
              <tr key={r.categoryCode}>
                <td className="px-3 py-2 font-mono font-bold text-odoo-text-strong">{r.categoryCode}</td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <input type="text" value={r.categoryName}
                      onChange={(e) => patch(r.categoryCode, { categoryName: e.target.value })}
                      className="odoo-input w-40" />
                  ) : <span>{r.categoryName || "—"}</span>}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <select value={r.pointmapCategory}
                      onChange={(e) => patch(r.categoryCode, { pointmapCategory: e.target.value })}
                      className="odoo-input w-28">
                      <option value="">—</option>
                      {pointmapOptions(r.pointmapCategory).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : <span className="font-mono text-xs">{r.pointmapCategory || "—"}</span>}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <select value={r.groupCode} onChange={(e) => patch(r.categoryCode, { groupCode: e.target.value })} className="odoo-input w-28">
                      {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  ) : <span className="font-mono text-xs">{r.groupCode}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="0.1" value={r.weight}
                      onChange={(e) => patch(r.categoryCode, { weight: Number(e.target.value) })}
                      className="odoo-input w-20 text-right" />
                  ) : <span className="font-mono">{r.weight}</span>}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <input type="text" value={r.sdaSubtype} list="cat-sda" placeholder="—"
                      onChange={(e) => patch(r.categoryCode, { sdaSubtype: e.target.value.toUpperCase() })}
                      className="odoo-input w-24 uppercase" />
                  ) : <span className="font-mono text-xs">{r.sdaSubtype || "—"}</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={r.isActive} disabled={!canManage}
                    onChange={(e) => patch(r.categoryCode, { isActive: e.target.checked })}
                    className="h-4 w-4 accent-odoo-primary" />
                </td>
                {canManage ? (
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" disabled={busy === r.categoryCode}
                        onClick={() => void send("PUT", r, r.categoryCode)}
                        className="odoo-btn odoo-btn-primary disabled:opacity-40">ບັນທຶກ</button>
                      <button type="button" disabled={busy === r.categoryCode}
                        onClick={() => void remove(r.categoryCode)}
                        className="odoo-btn text-rose-600 disabled:opacity-40">ລຶບ</button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <div className="mt-3 rounded-lg border border-odoo-border bg-odoo-surface-muted p-3">
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-odoo-text-strong">ເພີ່ມໝວດໃໝ່</div>
          <div className="flex flex-wrap items-end gap-2">
            <input placeholder="ລະຫັດ" value={draft.categoryCode}
              onChange={(e) => setDraft({ ...draft, categoryCode: e.target.value.trim() })}
              className="odoo-input w-24" />
            <input placeholder="ຊື່ໝວດ" value={draft.categoryName}
              onChange={(e) => setDraft({ ...draft, categoryName: e.target.value })}
              className="odoo-input min-w-[140px] flex-1" />
            <select value={draft.pointmapCategory}
              onChange={(e) => setDraft({ ...draft, pointmapCategory: e.target.value })}
              className="odoo-input w-28">
              <option value="">ໝວດຄະແນນ…</option>
              {pointmapOptions(draft.pointmapCategory).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select value={draft.groupCode} onChange={(e) => setDraft({ ...draft, groupCode: e.target.value })} className="odoo-input w-28">
              {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input type="number" min="0" step="0.1" placeholder="ນ້ຳໜັກ" value={draft.weight}
              onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
              className="odoo-input w-20 text-right" />
            <input placeholder="SDA subtype" value={draft.sdaSubtype} list="cat-sda"
              onChange={(e) => setDraft({ ...draft, sdaSubtype: e.target.value.toUpperCase() })}
              className="odoo-input w-24 uppercase" />
            <button type="button" disabled={busy === "__new__" || !draft.categoryCode.trim()}
              onClick={() => void create()}
              className="odoo-btn odoo-btn-primary disabled:opacity-40">ເພີ່ມ</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
