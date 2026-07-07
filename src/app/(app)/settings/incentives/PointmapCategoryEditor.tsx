"use client";

import { useCallback, useEffect, useState } from "react";

// Master list of point categories (app_incentive_pointmap_category) — defines
// WHICH product categories exist (AV / Air / REF / SDA / Washer …). The Category
// Map's pointmap field picks from this list.
type PointCat = { code: string; label: string; sortOrder: number; isActive: boolean };

const emptyDraft = { code: "", label: "", sortOrder: "0" };

export default function PointmapCategoryEditor({
  canManage,
  onChange,
}: {
  canManage: boolean;
  onChange?: () => void;
}) {
  const [rows, setRows] = useState<PointCat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/incentives/pointmap-categories", { cache: "no-store" });
      const body = (await res.json()) as { categories: PointCat[]; error?: string };
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

  const patch = (code: string, changes: Partial<PointCat>) =>
    setRows((prev) => prev.map((r) => (r.code === code ? { ...r, ...changes } : r)));

  async function send(method: "PUT" | "POST", payload: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch("/api/incentives/pointmap-categories", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { categories: PointCat[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRows(body.categories);
      onChange?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove(code: string) {
    if (!window.confirm(`ລຶບໝວດຄະແນນ ${code}?`)) return;
    setBusy(code);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/pointmap-categories?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { categories: PointCat[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRows(body.categories);
      onChange?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const ok = await send("POST", { ...draft, sortOrder: Number(draft.sortOrder) || 0 }, "__new__");
    if (ok) setDraft(emptyDraft);
  }

  return (
    <section className="odoo-card incentive-editor incentive-editor--pointcats p-4">
      <div className="incentive-editor-head mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">ໝວດຄະແນນ (Point Categories)</h2>
          <p className="text-xs text-odoo-text-muted">ກຳນົດວ່າມີໝວດຄະແນນໃດແດ່ (AV / Air / REF / SDA / Washer …)</p>
        </div>
        <button type="button" onClick={() => void load()} className="odoo-btn">ໂຫລດໃໝ່</button>
      </div>

      {error ? <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      <div className="incentive-table-wrap overflow-x-auto">
        <table className="odoo-table incentive-data-table min-w-[520px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລະຫັດ</th>
              <th className="px-3 py-2">ຊື່ສະແດງ</th>
              <th className="px-3 py-2 text-right">ລຳດັບ</th>
              <th className="px-3 py-2 text-center">ໃຊ້ງານ</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
            ) : rows.map((r) => (
              <tr key={r.code}>
                <td className="px-3 py-2 font-mono font-bold text-odoo-text-strong">{r.code}</td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <input type="text" value={r.label}
                      onChange={(e) => patch(r.code, { label: e.target.value })}
                      className="odoo-input w-40" />
                  ) : <span>{r.label || "—"}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" step="1" value={r.sortOrder}
                      onChange={(e) => patch(r.code, { sortOrder: Number(e.target.value) })}
                      className="odoo-input w-16 text-right" />
                  ) : <span className="font-mono">{r.sortOrder}</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={r.isActive} disabled={!canManage}
                    onChange={(e) => patch(r.code, { isActive: e.target.checked })}
                    className="h-4 w-4 accent-odoo-primary" />
                </td>
                {canManage ? (
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" disabled={busy === r.code}
                        onClick={() => void send("PUT", r, r.code)}
                        className="odoo-btn odoo-btn-primary disabled:opacity-40">ບັນທຶກ</button>
                      <button type="button" disabled={busy === r.code}
                        onClick={() => void remove(r.code)}
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
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-odoo-text-strong">ເພີ່ມໝວດຄະແນນໃໝ່</div>
          <div className="flex flex-wrap items-end gap-2">
            <input placeholder="ລະຫັດ (ເຊັ່ນ Fan)" value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.trim() })}
              className="odoo-input w-32" />
            <input placeholder="ຊື່ສະແດງ" value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              className="odoo-input min-w-[140px] flex-1" />
            <input type="number" step="1" placeholder="ລຳດັບ" value={draft.sortOrder}
              onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
              className="odoo-input w-20 text-right" />
            <button type="button" disabled={busy === "__new__" || !draft.code.trim()}
              onClick={() => void create()}
              className="odoo-btn odoo-btn-primary disabled:opacity-40">ເພີ່ມ</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
