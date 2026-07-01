"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
type Employee = { employeeCode: string; fullnameLo?: string | null; fullnameEn?: string | null; nickname?: string | null };

export default function IncentiveConfigClient({ canManage, embedded = false }: { canManage: boolean; embedded?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [targetYear, setTargetYear] = useState(2026);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTarget, setNewTarget] = useState({ employeeCode: "", year: 2026, month: 1, groupCode: "CE", target: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, employeeResponse] = await Promise.all([
        fetch("/api/incentives/config", { cache: "no-store" }),
        fetch("/api/employees", { cache: "no-store" }),
      ]);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Error ${response.status}`);
      setData(json as Payload);
      if (employeeResponse.ok) setEmployees(await employeeResponse.json() as Employee[]);
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

  async function addTarget() {
    if (!canManage || saving || !newTarget.employeeCode) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/incentives/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTarget),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `Error ${response.status}`);
      setData(json as Payload);
      setTargetYear(newTarget.year);
      setAdding(false);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Add failed");
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

  function targetField(index: number, value: string) {
    if (!data) return;
    const targets = [...data.targets];
    targets[index] = { ...targets[index], target: Number(value) };
    setData({ ...data, targets });
  }

  const targetYears = useMemo(
    () => Array.from(new Set((data?.targets ?? []).map((row) => row.year))).sort((a, b) => b - a),
    [data],
  );
  const pivotRows = useMemo(() => {
    const rows = new Map<string, { employeeCode: string; displayName: string; groupCode: "CE" | "AC"; cells: Map<number, number> }>();
    (data?.targets ?? []).forEach((target, index) => {
      if (target.year !== targetYear) return;
      const key = `${target.employeeCode}-${target.groupCode}`;
      const row = rows.get(key) ?? {
        employeeCode: target.employeeCode,
        displayName: target.displayName,
        groupCode: target.groupCode,
        cells: new Map<number, number>(),
      };
      row.cells.set(target.month, index);
      rows.set(key, row);
    });
    return Array.from(rows.values()).sort((a, b) =>
      a.groupCode.localeCompare(b.groupCode) || a.displayName.localeCompare(b.displayName),
    );
  }, [data, targetYear]);

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
            <h2 className="mb-4 text-sm font-black text-odoo-text-strong">ສູດໂບນັດ</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="ໂບນັດພື້ນຖານ/ຊິ້ນ" value={data.config.baseAmount} onChange={(v) => configField("baseAmount", v)} disabled={!canManage} />
              <Field label="ສະກຸນເງິນ" value={data.config.currencyCode} onChange={(v) => configField("currencyCode", v)} disabled={!canManage} text />
              <Field label="ເກນຕ່ຳສຸດ (0.80 = 80%)" value={data.config.lowMaxPct} onChange={(v) => configField("lowMaxPct", v)} disabled={!canManage} step="0.01" />
              <Field label="ເກນມາດຕະຖານ" value={data.config.standardMaxPct} onChange={(v) => configField("standardMaxPct", v)} disabled={!canManage} step="0.01" />
              <Field label="ຕົວຄູນຜົນງານຕ່ຳ" value={data.config.lowMultiplier} onChange={(v) => configField("lowMultiplier", v)} disabled={!canManage} step="0.01" />
              <Field label="ຕົວຄູນມາດຕະຖານ" value={data.config.standardMultiplier} onChange={(v) => configField("standardMultiplier", v)} disabled={!canManage} step="0.01" />
              <Field label="ຕົວຄູນຜົນງານສູງ" value={data.config.highMultiplier} onChange={(v) => configField("highMultiplier", v)} disabled={!canManage} step="0.01" />
              <Field label="ຄ່າຄອມພື້ນຖານ/ຄົນ" value={data.config.commissionBase} onChange={(v) => configField("commissionBase", v)} disabled={!canManage} step="100" />
            </div>
          </section>

          <section className="odoo-card mt-4 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-odoo-border px-4 py-3">
              <div><h2 className="text-sm font-black text-odoo-text-strong">Pivot ເປົ້າຂາຍລາຍເດືອນ</h2><p className="mt-1 text-xs text-odoo-text-muted">ແຖວ = ພະນັກງານ · Column = ເດືອນ</p></div>
              <div className="flex items-center gap-2"><label className="flex items-center gap-2"><span className="odoo-label">ປີ</span><select value={targetYear} onChange={(event) => setTargetYear(Number(event.target.value))} className="odoo-input w-28">{targetYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><button type="button" onClick={() => setAdding((value) => !value)} disabled={!canManage} className="odoo-btn odoo-btn-primary">+ ເພີ່ມ Target</button></div>
            </div>
            {adding ? (
              <div className="grid gap-3 border-b border-odoo-border bg-odoo-surface-muted p-4 sm:grid-cols-2 lg:grid-cols-6">
                <label className="grid gap-1 lg:col-span-2"><span className="odoo-label">ພະນັກງານ</span><select value={newTarget.employeeCode} onChange={(event) => setNewTarget({ ...newTarget, employeeCode: event.target.value })} className="odoo-input"><option value="">ເລືອກພະນັງການ</option>{employees.map((employee) => <option key={employee.employeeCode} value={employee.employeeCode}>{employee.fullnameLo || employee.fullnameEn || employee.nickname || employee.employeeCode} ({employee.employeeCode})</option>)}</select></label>
                <Field label="ປີ" value={newTarget.year} onChange={(value) => setNewTarget({ ...newTarget, year: Number(value) })} disabled={saving} />
                <Field label="ເດືອນ" value={newTarget.month} onChange={(value) => setNewTarget({ ...newTarget, month: Number(value) })} disabled={saving} />
                <label className="grid gap-1"><span className="odoo-label">ກຸ່ມ</span><select value={newTarget.groupCode} onChange={(event) => setNewTarget({ ...newTarget, groupCode: event.target.value })} className="odoo-input"><option value="CE">CE + SDA</option><option value="AC">AIR</option></select></label>
                <div className="grid grid-cols-[1fr_auto] items-end gap-2"><Field label="ເປົ້າ" value={newTarget.target} onChange={(value) => setNewTarget({ ...newTarget, target: Number(value) })} disabled={saving} /><button type="button" onClick={() => void addTarget()} disabled={saving || !newTarget.employeeCode} className="odoo-btn odoo-btn-primary">ເພີ່ມ</button></div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="odoo-table min-w-[1500px]">
                <thead><tr><th className="sticky left-0 z-10 min-w-56 bg-odoo-surface-muted px-4 py-3">ພະນັກງານ</th><th className="px-3 py-3">ກຸ່ມ</th>{Array.from({ length: 12 }, (_, month) => <th key={month + 1} className="min-w-32 px-3 py-3 text-right">{String(month + 1).padStart(2, "0")}</th>)}</tr></thead>
                <tbody className="divide-y divide-odoo-border">
                  {pivotRows.map((row) => (
                    <tr key={`${row.employeeCode}-${row.groupCode}`}>
                      <td className="sticky left-0 z-[1] bg-odoo-surface px-4 py-2"><div className="font-bold">{row.displayName}</div><div className="font-mono text-[10px] text-odoo-text-muted">{row.employeeCode}</div></td>
                      <td className="whitespace-nowrap px-3 py-2 font-bold">{row.groupCode === "AC" ? "AIR" : "CE + SDA"}</td>
                      {Array.from({ length: 12 }, (_, monthIndex) => {
                        const targetIndex = row.cells.get(monthIndex + 1);
                        return <td key={monthIndex + 1} className="px-2 py-2">{targetIndex == null ? <span className="block text-center text-odoo-text-muted">—</span> : <input type="number" value={data.targets[targetIndex].target} onChange={(event) => targetField(targetIndex, event.target.value)} disabled={!canManage} className="odoo-input w-28 text-right font-mono" />}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
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
