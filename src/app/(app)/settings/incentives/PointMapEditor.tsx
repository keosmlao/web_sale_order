"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PointRow = {
  categoryCode: string;
  brandCode: string;
  designToken: string;
  sizeToken: string;
  points: number;
};

type PointMap = { categories: string[]; rows: PointRow[] };

const keyOf = (r: Pick<PointRow, "categoryCode" | "brandCode" | "designToken" | "sizeToken">) =>
  `${r.categoryCode}|${r.brandCode}|${r.designToken}|${r.sizeToken}`;

const emptyDraft = { categoryCode: "", brandCode: "", designToken: "", sizeToken: "", points: "" };

export default function PointMapEditor({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<PointMap | null>(null);
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/incentives/point-map", { cache: "no-store" });
      const body = (await res.json()) as PointMap & { error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setData(body);
      setCategory((prev) => prev || body.categories[0] || "");
      setEdits({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => r.categoryCode === category),
    [data, category],
  );

  async function send(method: "PUT" | "DELETE", row: Omit<PointRow, "points"> & { points?: number }) {
    setBusy(keyOf(row));
    setError(null);
    try {
      const res = await fetch("/api/incentives/point-map", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      const body = (await res.json()) as PointMap & { error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setData(body);
      setEdits({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  const saveRow = (row: PointRow) => {
    const raw = edits[keyOf(row)];
    const points = Number(raw);
    if (!Number.isFinite(points) || points < 0) {
      setError("ຄະແນນຕ້ອງເປັນຕົວເລກ ≥ 0");
      return;
    }
    void send("PUT", { ...row, points });
  };

  const addRow = () => {
    const points = Number(draft.points);
    if (!draft.categoryCode.trim() || !draft.brandCode.trim() || !Number.isFinite(points) || points < 0) {
      setError("ຕ້ອງມີ ໝວດ, ຍີ່ຫໍ້ ແລະ ຄະແນນ ≥ 0");
      return;
    }
    void send("PUT", {
      categoryCode: draft.categoryCode.trim(),
      brandCode: draft.brandCode.trim().toUpperCase(),
      designToken: draft.designToken.trim(),
      sizeToken: draft.sizeToken.trim(),
      points,
    }).then(() => setDraft(emptyDraft));
  };

  return (
    <section className="odoo-card mt-6 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">ຄະແນນໂບນັດ (Point Map)</h2>
          <p className="text-xs text-odoo-text-muted">ຄະແນນ/ຊິ້ນ ຕາມ ໝວດ · ຍີ່ຫໍ້ · ດີໄຊ · ຂະໜາດ — ໃຊ້ຄິດໄລ່ໂບນັດ</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="odoo-input">
            {(data?.categories ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="button" onClick={() => void load()} className="odoo-btn">ໂຫລດໃໝ່</button>
        </div>
      </div>

      {error ? <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      <div className="overflow-x-auto">
        <table className="odoo-table min-w-[720px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ຍີ່ຫໍ້</th>
              <th className="px-3 py-2">ດີໄຊ / Design</th>
              <th className="px-3 py-2">ຂະໜາດ / Size</th>
              <th className="px-3 py-2 text-right">ຄະແນນ/ຊິ້ນ</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
            ) : rows.map((row) => {
              const k = keyOf(row);
              const editing = k in edits;
              return (
                <tr key={k}>
                  <td className="px-3 py-2 font-bold text-odoo-text-strong">{row.brandCode}</td>
                  <td className="px-3 py-2">{row.designToken || <span className="text-odoo-text-muted">—</span>}</td>
                  <td className="px-3 py-2">{row.sizeToken || <span className="text-odoo-text-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right">
                    {canManage ? (
                      <input
                        type="number" step="0.01" min="0"
                        value={editing ? edits[k] : String(row.points)}
                        onChange={(e) => setEdits((p) => ({ ...p, [k]: e.target.value }))}
                        className="odoo-input w-24 text-right"
                      />
                    ) : (
                      <span className="font-mono">{row.points}</span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2 text-right">
                      <button type="button" disabled={!editing || busy === k} onClick={() => saveRow(row)} className="odoo-btn odoo-btn-primary mr-2 disabled:opacity-40">ບັນທຶກ</button>
                      <button type="button" disabled={busy === k} onClick={() => { if (confirm(`ລຶບ ${row.brandCode} ${row.designToken} ${row.sizeToken}?`)) void send("DELETE", row); }} className="odoo-btn text-odoo-danger disabled:opacity-40">ລຶບ</button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <div className="mt-4 grid gap-2 rounded-md border border-odoo-border bg-odoo-surface-muted p-3 sm:grid-cols-6">
          <input placeholder="ໝວດ (REF…)" value={draft.categoryCode} onChange={(e) => setDraft((d) => ({ ...d, categoryCode: e.target.value }))} className="odoo-input" list="pm-cats" />
          <datalist id="pm-cats">{(data?.categories ?? []).map((c) => <option key={c} value={c} />)}</datalist>
          <input placeholder="ຍີ່ຫໍ້" value={draft.brandCode} onChange={(e) => setDraft((d) => ({ ...d, brandCode: e.target.value }))} className="odoo-input" />
          <input placeholder="ດີໄຊ" value={draft.designToken} onChange={(e) => setDraft((d) => ({ ...d, designToken: e.target.value }))} className="odoo-input" />
          <input placeholder="ຂະໜາດ" value={draft.sizeToken} onChange={(e) => setDraft((d) => ({ ...d, sizeToken: e.target.value }))} className="odoo-input" />
          <input placeholder="ຄະແນນ" type="number" step="0.01" min="0" value={draft.points} onChange={(e) => setDraft((d) => ({ ...d, points: e.target.value }))} className="odoo-input" />
          <button type="button" onClick={addRow} className="odoo-btn odoo-btn-primary">ເພີ່ມ / ອັບເດດ</button>
        </div>
      ) : null}
    </section>
  );
}
