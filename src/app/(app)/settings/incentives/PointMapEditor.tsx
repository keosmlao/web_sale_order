"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Rule = { id: string; categoryCode: string; brandCode: string; designToken: string; sizeToken: string; effectiveFrom: string; effectiveTo: string; points: number; isSpecial: boolean };
type Data = { categories: string[]; rows: Rule[]; options?: { categories: string[]; brands: string[]; designTokens: string[]; sizeTokens: string[] } };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vientiane" }).format(new Date());
const emptyDraft = { categoryCode: "", brandCode: "", designToken: "", sizeToken: "", effectiveFrom: today(), effectiveTo: today(), points: "", isSpecial: false };

export default function PointMapEditor({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/incentives/point-map", { cache: "no-store" });
      const body = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
      setData(body); setCategory((current) => current || body.categories[0] || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Fetch failed"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { Promise.resolve().then(() => void load()); }, [load]);

  const rows = useMemo(() => (data?.rows ?? []).filter((row) => row.categoryCode === category), [data, category]);
  async function save() {
    const points = Number(draft.points);
    if (!draft.categoryCode || !draft.brandCode || !draft.effectiveFrom || !draft.effectiveTo || draft.effectiveTo < draft.effectiveFrom || !Number.isFinite(points) || points < 0) { setError("ກະລຸນາກວດສິນຄ້າ, ຊ່ວງວັນທີ ແລະຄະແນນ"); return; }
    setBusy("new"); setError(null);
    try {
      const response = await fetch("/api/incentives/point-map", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, points }) });
      const body = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
      setData(body); setCategory(draft.categoryCode); setDraft({ ...emptyDraft, effectiveFrom: today(), effectiveTo: today() });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed"); }
    finally { setBusy(null); }
  }
  async function remove(id: string) {
    setBusy(id); setError(null);
    try {
      const response = await fetch("/api/incentives/point-map", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(body.error || `Error ${response.status}`); setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Delete failed"); }
    finally { setBusy(null); }
  }

  return <section className="odoo-card incentive-editor incentive-editor--points p-4">
    <div className="incentive-editor-head mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2>ຄະແນນໂບນັດ (Point Map)</h2><p className="text-xs text-odoo-text-muted">ກຳນົດເປັນຊ່ວງວັນທີ; ວັນພິເສດຈະຊະນະຊ່ວງປົກກະຕິ</p></div><div className="incentive-filters"><select value={category} onChange={(event) => setCategory(event.target.value)} className="odoo-input">{(data?.categories ?? []).map((item) => <option key={item}>{item}</option>)}</select></div></div>
    {error ? <div className="mx-4 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</div> : null}
    {canManage ? <div className="point-rule-form incentive-add-panel">
      <input placeholder="ໝວດ" list="pm-cats" value={draft.categoryCode} onChange={(e) => setDraft({ ...draft, categoryCode: e.target.value })} className="odoo-input" />
      <input placeholder="ຍີ່ຫໍ້" list="pm-brands" value={draft.brandCode} onChange={(e) => setDraft({ ...draft, brandCode: e.target.value.toUpperCase() })} className="odoo-input" />
      <input placeholder="Design" list="pm-designs" value={draft.designToken} onChange={(e) => setDraft({ ...draft, designToken: e.target.value })} className="odoo-input" />
      <input placeholder="Size" list="pm-sizes" value={draft.sizeToken} onChange={(e) => setDraft({ ...draft, sizeToken: e.target.value })} className="odoo-input" />
      <label><span>ຈາກວັນທີ</span><input type="date" value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value, effectiveTo: draft.isSpecial ? e.target.value : draft.effectiveTo })} className="odoo-input" /></label>
      <label><span>ຫາວັນທີ</span><input type="date" disabled={draft.isSpecial} value={draft.isSpecial ? draft.effectiveFrom : draft.effectiveTo} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })} className="odoo-input" /></label>
      <label><span>ຄະແນນ</span><input type="number" min="0" step="0.01" value={draft.points} onChange={(e) => setDraft({ ...draft, points: e.target.value })} className="odoo-input" /></label>
      <label className="point-special"><input type="checkbox" checked={draft.isSpecial} onChange={(e) => setDraft({ ...draft, isSpecial: e.target.checked, effectiveTo: e.target.checked ? draft.effectiveFrom : draft.effectiveTo })} /><span>ວັນພິເສດ</span></label>
      <button type="button" onClick={() => void save()} disabled={busy === "new"} className="odoo-btn odoo-btn-primary">ເພີ່ມກຳນົດ</button>
      <datalist id="pm-cats">{data?.options?.categories.map((v) => <option key={v} value={v} />)}</datalist><datalist id="pm-brands">{data?.options?.brands.map((v) => <option key={v} value={v} />)}</datalist><datalist id="pm-designs">{data?.options?.designTokens.map((v) => <option key={v} value={v} />)}</datalist><datalist id="pm-sizes">{data?.options?.sizeTokens.map((v) => <option key={v} value={v} />)}</datalist>
    </div> : null}
    <div className="incentive-table-wrap overflow-x-auto"><table className="odoo-table incentive-data-table min-w-[900px]"><thead><tr><th>ສິນຄ້າ</th><th>ຈາກວັນທີ</th><th>ຫາວັນທີ</th><th>ປະເພດ</th><th className="text-right">Point</th>{canManage ? <th /> : null}</tr></thead><tbody>{loading ? <tr><td colSpan={6}>ກຳລັງໂຫລດ…</td></tr> : rows.map((row) => <tr key={row.id}><td><strong>{row.brandCode}</strong><small className="block text-odoo-text-muted">{row.designToken || "—"} · {row.sizeToken || "—"}</small></td><td>{row.effectiveFrom}</td><td>{row.effectiveTo}</td><td>{row.isSpecial ? <span className="point-special-badge">ວັນພິເສດ</span> : "ຊ່ວງປົກກະຕິ"}</td><td className="text-right font-mono font-bold">{row.points}</td>{canManage ? <td className="text-right"><button type="button" disabled={busy === row.id} onClick={() => confirm("ລຶບກຳນົດນີ້?") && void remove(row.id)} className="odoo-btn text-rose-600">ລຶບ</button></td> : null}</tr>)}</tbody></table></div>
  </section>;
}
