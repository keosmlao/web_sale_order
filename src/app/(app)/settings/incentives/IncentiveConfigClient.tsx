"use client";

import { useCallback, useEffect, useState } from "react";

type Config = {
  baseAmount: number;
  currencyCode: string;
  lowMaxPct: number;
  standardMaxPct: number;
  lowMultiplier: number;
  standardMultiplier: number;
  highMultiplier: number;
  commissionBase: number;
  updatedAt: string;
};

type Target = {
  rowOrder: number;
  employeeCode: string;
  displayName: string;
  year: number;
  month: number;
  groupCode: "CE" | "AC";
  target: number;
};

type Payload = { config: Config; targets: Target[] };

export default function IncentiveConfigClient({ canManage, embedded = false }: { canManage: boolean; embedded?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/incentives/config", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Error ${response.status}`);
      setData(json as Payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => void load());
  }, [load]);

  async function save() {
    if (!data || !canManage || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/incentives/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Error ${response.status}`);
      setData(json as Payload);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function configField(key: keyof Config, value: string) {
    if (!data) return;
    setData({
      ...data,
      config: { ...data.config, [key]: key === "currencyCode" ? value : Number(value) },
    });
  }


  if (loading) return <div className={embedded ? "text-sm text-odoo-text-muted" : "odoo-page text-sm text-odoo-text-muted"}>ກຳລັງໂຫລດ…</div>;

  const saveButton = (
    <button type="button" onClick={() => void save()} disabled={!canManage || !data || saving} className="odoo-btn odoo-btn-primary">
      {saving ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກ Config"}
    </button>
  );

  return (
    <div className={embedded ? "" : "odoo-page"}>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-odoo-text-muted">ກຳນົດໂບນັດຕໍ່ຊິ້ນ, ເກນຜົນງານ, ຄ່າຄອມ ແລະເປົ້າຂາຍລາຍເດືອນ.</p>
          {saveButton}
        </div>
      ) : (
        <div className="odoo-page-header">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">Settings</div>
            <h1 className="odoo-page-title">Config Incentive</h1>
            <p className="odoo-page-subtitle">ກຳນົດໂບນັດຕໍ່ຊິ້ນ, ເກນຜົນງານ ແລະເປົ້າຂາຍລາຍເດືອນ.</p>
          </div>
          {saveButton}
        </div>
      )}

      {!canManage ? <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">ສະຖານະອ່ານຢ່າງດຽວ</div> : null}
      {error ? <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-odoo-danger">{error}</div> : null}
      {saved ? <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">ບັນທຶກສຳເລັດ</div> : null}

      {data ? (
        <>
          <section className="odoo-card p-4">
            <h2 className="text-sm font-black text-odoo-text-strong">① ໂບນັດ</h2>
            <p className="mb-4 text-xs text-odoo-text-muted">ໂບນັດ/ຊິ້ນ = ຄະແນນ × ໂບນັດພື້ນຖານ × ຕົວຄູນຜົນງານ × ສະຖານະສິນຄ້າ</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="ໂບນັດພື້ນຖານ/ຊິ້ນ (฿)" value={data.config.baseAmount} onChange={(v) => configField("baseAmount", v)} disabled={!canManage} />
              <Field label="ສະກຸນເງິນ" value={data.config.currencyCode} onChange={(v) => configField("currencyCode", v)} disabled={!canManage} text />
            </div>
          </section>

          <section className="odoo-card mt-4 p-4">
            <h2 className="text-sm font-black text-odoo-text-strong">ເກນຜົນງານ (ຕົວຄູນ)</h2>
            <p className="mb-4 text-xs text-odoo-text-muted">ຍອດຂາຍ ÷ ເປົ້າ/ຄົນ → ຕົວຄູນ ໃສ່ ① ໂບນັດ</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="ເກນຕ່ຳສຸດ (0.50 = 50%)" value={data.config.lowMaxPct} onChange={(v) => configField("lowMaxPct", v)} disabled={!canManage} step="0.01" />
              <Field label="ເກນມາດຕະຖານ (1.0 = 100%)" value={data.config.standardMaxPct} onChange={(v) => configField("standardMaxPct", v)} disabled={!canManage} step="0.01" />
              <Field label="ຕົວຄູນຜົນງານຕ່ຳ" value={data.config.lowMultiplier} onChange={(v) => configField("lowMultiplier", v)} disabled={!canManage} step="0.01" />
              <Field label="ຕົວຄູນມາດຕະຖານ" value={data.config.standardMultiplier} onChange={(v) => configField("standardMultiplier", v)} disabled={!canManage} step="0.01" />
              <Field label="ຕົວຄູນຜົນງານສູງ" value={data.config.highMultiplier} onChange={(v) => configField("highMultiplier", v)} disabled={!canManage} step="0.01" />
            </div>
          </section>

          <section className="odoo-card mt-4 p-4">
            <h2 className="text-sm font-black text-odoo-text-strong">③ ຄ່າຄອມ</h2>
            <p className="mb-4 text-xs text-odoo-text-muted">ຄ່າຄອມ = ຄ່າຄອມພື້ນຖານ × ເລດ (ຜົນງານ &lt;80%=0 · 80–100% ປັດລົງ 5% · ≥100% ປັດຂຶ້ນ 5%)</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="ຄ່າຄອມພື້ນຖານ/ຄົນ (฿)" value={data.config.commissionBase} onChange={(v) => configField("commissionBase", v)} disabled={!canManage} step="100" />
            </div>
          </section>

          {/* Target editing moved to its own tab (🎯 ເປົ້າຂາຍ) — one pivot
              covering every seller per month, replacing the old per-row
              year grid so targets are edited in exactly one place. */}
          <section className="odoo-card mt-4 flex items-center gap-3 p-4">
            <span aria-hidden className="text-xl">🎯</span>
            <div className="text-xs text-odoo-text-muted">
              <b className="text-odoo-text-strong">ເປົ້າຂາຍລາຍເດືອນ</b> ຍ້າຍໄປ tab
              <b className="text-odoo-primary"> ເປົ້າຂາຍ </b>
              — ຕັ້ງເປົ້າ CE/AC ໃຫ້ພະນັກງານຂາຍທຸກຄົນເທື່ອລະເດືອນ
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, disabled, text = false, step }: { label: string; value: string | number; onChange: (value: string) => void; disabled: boolean; text?: boolean; step?: string }) {
  return <label className="grid gap-1"><span className="odoo-label">{label}</span><input type={text ? "text" : "number"} step={step} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="odoo-input" /></label>;
}
