"use client";

import { useCallback, useEffect, useState } from "react";

// Per-position commission-rate tiers (app_incentive_commission_tier). Managers /
// heads edit an ordered list of tiers per position; each tier says: from this
// achievement %, pay by this mode (0 / round down / round up / exact %). The
// three positions are independent — copy one onto another to make them match.

const POSITIONS = [
  { code: "13", label: "ພະນັກງານຂາຍ" },
  { code: "11", label: "ຜູ້ຈັດການ" },
  { code: "12", label: "ຫົວໜ້າໜ່ວຍງານ" },
] as const;

const MODES = [
  { value: "zero", label: "ບໍ່ໄດ້ຄ່າຄອມ" },
  { value: "round_down", label: "ປັດລົງ" },
  { value: "round_up", label: "ປັດຂຶ້ນ" },
  { value: "exact", label: "ຄ່າຈິງ (ບໍ່ປັດ)" },
] as const;

// Row values are edited as percent strings; converted to fractions on save.
type Row = { fromPct: string; mode: string; roundStep: string };
type State = Record<string, Row[]>;
type ApiTier = { positionCode: string; fromPct: number; mode: string; roundStep: number };

const emptyState = (): State => ({ "13": [], "11": [], "12": [] });
const newRow = (): Row => ({ fromPct: "0", mode: "round_down", roundStep: "5" });

export default function CommissionTierEditor({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<State>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/incentives/commission-tier", { cache: "no-store" });
      const data = (await res.json()) as { tiers: ApiTier[] | null };
      if (data.tiers === null) {
        setMissing(true);
      } else {
        const next = emptyState();
        for (const t of data.tiers) {
          (next[t.positionCode] ??= []).push({
            fromPct: String(Math.round(t.fromPct * 100 * 1e6) / 1e6),
            mode: t.mode,
            roundStep: String(Math.round(t.roundStep * 100 * 1e6) / 1e6),
          });
        }
        for (const code of Object.keys(next)) next[code].sort((a, b) => Number(a.fromPct) - Number(b.fromPct));
        setState(next);
        setMissing(false);
      }
    } catch {
      setMissing(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update(pos: string, index: number, key: keyof Row, value: string) {
    setState((s) => {
      const rows = s[pos].slice();
      rows[index] = { ...rows[index], [key]: value };
      return { ...s, [pos]: rows };
    });
  }
  function addRow(pos: string) {
    setState((s) => ({ ...s, [pos]: [...s[pos], newRow()] }));
  }
  function removeRow(pos: string, index: number) {
    setState((s) => ({ ...s, [pos]: s[pos].filter((_, i) => i !== index) }));
  }
  function copyFromSeller(pos: string) {
    setState((s) => ({ ...s, [pos]: s["13"].map((r) => ({ ...r })) }));
  }

  async function save() {
    if (!canManage || saving) return;
    setSaving(true);
    setNotice(null);
    // Flatten to fractions for the API.
    const tiers: ApiTier[] = [];
    for (const { code } of POSITIONS) {
      for (const r of state[code]) {
        tiers.push({
          positionCode: code,
          fromPct: Number(r.fromPct) / 100,
          mode: r.mode,
          roundStep: Number(r.roundStep) / 100,
        });
      }
    }
    // Client-side guardrails mirroring the API.
    for (const { code, label } of POSITIONS) {
      if (state[code].length === 0) {
        setNotice({ ok: false, text: `${label} ຕ້ອງມີຢ່າງໜ້ອຍ 1 ຂັ້ນ` });
        setSaving(false);
        return;
      }
    }
    const bad = tiers.find((t) => !Number.isFinite(t.fromPct) || t.fromPct < 0 || t.fromPct > 5 || !(t.roundStep > 0 && t.roundStep <= 1));
    if (bad) {
      setNotice({ ok: false, text: "ຄ່າຂັ້ນບໍ່ຖືກຕ້ອງ (ຕັ້ງແຕ່ % 0–500, ຂັ້ນປັດ 0–100%)" });
      setSaving(false);
      return;
    }
    try {
      const res = await fetch("/api/incentives/commission-tier", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setNotice({ ok: true, text: "ບັນທຶກຂັ້ນຄ່າຄອມແລ້ວ" });
      await load();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="odoo-card incentive-editor incentive-editor--matrix mt-4 p-5">
      <div className="commission-heading">
        <div>
          <span className="commission-kicker">04 / COMMISSION TIERS</span>
          <h2 className="text-sm font-black text-odoo-text-strong">ຂັ້ນຄ່າຄອມ ຕໍ່ຕຳແໜ່ງ</h2>
          <p className="mt-1 text-xs text-odoo-text-muted">ເພີ່ມ/ລົບຂັ້ນໄດ້ · ແຕ່ລະຕຳແໜ່ງຕັ້ງເອງໄດ້</p>
        </div>
        {canManage ? (
          <button type="button" onClick={() => void save()} disabled={saving} className="odoo-btn odoo-btn-primary">
            {saving ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກຂັ້ນ"}
          </button>
        ) : null}
      </div>

      {!loaded ? (
        <div className="mt-4 text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : missing ? (
        <div className="odoo-alert-danger mt-4 px-3 py-2 text-xs font-semibold">
          ຕາຕະລາງຍັງບໍ່ຖືກສ້າງ — ຮັນ: node scripts/apply-sql.mjs sql/add-incentive-commission-tier.sql
        </div>
      ) : (
        <>
          {notice ? (
            <div className={`mt-3 rounded-md px-3 py-2 text-xs font-semibold ${notice.ok ? "border border-emerald-300 bg-emerald-50 text-emerald-700" : "border border-rose-300 bg-rose-50 text-rose-700"}`}>
              {notice.text}
            </div>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {POSITIONS.map(({ code, label }) => (
              <div key={code} className="rounded-xl border border-odoo-border bg-white p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-odoo-text-strong">
                    {label} <span className="text-odoo-text-muted">({code})</span>
                  </h3>
                  {canManage && code !== "13" ? (
                    <button type="button" onClick={() => copyFromSeller(code)} className="text-[11px] font-bold text-odoo-primary hover:underline">
                      ໃຊ້ຄືກັບ ຂາຍ
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 space-y-2">
                  {state[code].length === 0 ? (
                    <p className="text-[11px] text-odoo-text-muted">ຍັງບໍ່ມີຂັ້ນ</p>
                  ) : null}
                  {state[code].map((row, i) => {
                    const rounding = row.mode === "round_down" || row.mode === "round_up";
                    return (
                      <div key={i} className="flex items-center gap-1.5 rounded-lg bg-slate-50 p-1.5 text-[11px]">
                        <span className="text-odoo-text-muted">≥</span>
                        <input type="number" step="1" value={row.fromPct} disabled={!canManage} onChange={(e) => update(code, i, "fromPct", e.target.value)} className="w-12 rounded border border-odoo-border px-1 py-0.5 text-center font-bold" aria-label="ຕັ້ງແຕ່ %" />
                        <span className="text-odoo-text-muted">%</span>
                        <select value={row.mode} disabled={!canManage} onChange={(e) => update(code, i, "mode", e.target.value)} className="min-w-0 flex-1 rounded border border-odoo-border px-1 py-0.5">
                          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                        <input type="number" step="0.5" value={row.roundStep} disabled={!canManage || !rounding} onChange={(e) => update(code, i, "roundStep", e.target.value)} className="w-11 rounded border border-odoo-border px-1 py-0.5 text-center disabled:bg-slate-100 disabled:text-slate-300" aria-label="ຂັ້ນປັດ %" title="ຂັ້ນປັດ %" />
                        <span className={rounding ? "text-odoo-text-muted" : "text-slate-300"}>%</span>
                        {canManage ? (
                          <button type="button" onClick={() => removeRow(code, i)} className="rounded px-1 text-rose-500 hover:bg-rose-50" aria-label="ລົບຂັ້ນ">✕</button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {canManage ? (
                  <button type="button" onClick={() => addRow(code)} className="mt-2 w-full rounded-lg border border-dashed border-odoo-primary/40 py-1 text-[11px] font-bold text-odoo-primary hover:bg-odoo-primary/5">
                    ➕ ເພີ່ມຂັ້ນ
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-odoo-text-muted">
            ຄ່າຄອມ = <b>ຖານ (ຕາມຕຳແໜ່ງ × ກຸ່ມ)</b> × ອັດຕາຈາກຂັ້ນທີ່ຍอดขายຕົກ. ຕົວຢ່າງ: ≥80% ປັດລົງ 5% → 87% ໄດ້ 85%.
          </p>
        </>
      )}
    </section>
  );
}
