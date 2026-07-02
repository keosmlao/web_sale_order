"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ເປົ້າຂາຍລາຍເດືອນ — pivot ຕັ້ງເປົ້າ CE / AC ໃຫ້ພະນັກງານຂາຍ (pos 13) ທຸກຄົນ
// ຂອງເດືອນທີ່ເລືອກ, ບັນທຶກລົງ odg_retail_target_employee.

type Emp = { code: string; name: string; dept: string };
type TargetRow = { employeeCode: string; groupCode: string; target: number };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export default function TargetPivotEditor({ canManage }: { canManage: boolean }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Emp[]>([]);
  // "code|GROUP" → input string
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/incentives/targets?year=${y}&month=${m}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { employees: Emp[]; targets: TargetRow[] };
      setEmployees(data.employees ?? []);
      const next: Record<string, string> = {};
      for (const t of data.targets ?? []) {
        if (t.target > 0) next[`${t.employeeCode}|${t.groupCode}`] = String(t.target);
      }
      setValues(next);
    } catch {
      setEmployees([]);
      setValues({});
      setNotice({ ok: false, text: "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year, month);
  }, [load, year, month]);

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const entries = employees.flatMap((e) =>
        (["CE", "AC"] as const).map((g) => ({
          employeeCode: e.code,
          groupCode: g,
          target: Number(values[`${e.code}|${g}`] || 0),
        })),
      );
      const res = await fetch("/api/incentives/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, entries }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setNotice(
        res.ok
          ? { ok: true, text: `ບັນທຶກເປົ້າ ${MONTHS[month - 1]}/${year} ແລ້ວ` }
          : { ok: false, text: data.error ?? "ບັນທຶກບໍ່ສຳເລັດ" },
      );
    } catch {
      setNotice({ ok: false, text: "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    let ce = 0;
    let ac = 0;
    for (const e of employees) {
      ce += Number(values[`${e.code}|CE`] || 0);
      ac += Number(values[`${e.code}|AC`] || 0);
    }
    return { ce, ac, all: ce + ac };
  }, [employees, values]);

  return (
    <section className="odoo-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-odoo-text-strong">ເປົ້າຂາຍລາຍເດືອນ (ຕໍ່ຄົນ)</h2>
          <p className="mt-1 text-xs text-odoo-text-muted">
            ພະນັກງານຂາຍ (pos 13) ໜ້າຮ້ານທຸກຄົນ · CE = ເຄື່ອງໃຊ້ໄຟຟ້າ, AC = ແອ ·
            ປ່ອຍຫວ່າງ/0 = ບໍ່ຕັ້ງເປົ້າ
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="odoo-label">ເດືອນ</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="odoo-input">
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="odoo-label">ປີ</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="odoo-input">
              {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 text-center text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                  <th className="px-2 py-2 text-left">ພະນັກງານ</th>
                  <th className="px-2 py-2 text-right">ເປົ້າ CE</th>
                  <th className="px-2 py-2 text-right">ເປົ້າ AC (ແອ)</th>
                  <th className="px-2 py-2 text-right">ລວມ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-odoo-border">
                {employees.map((e) => {
                  const ce = Number(values[`${e.code}|CE`] || 0);
                  const ac = Number(values[`${e.code}|AC`] || 0);
                  return (
                    <tr key={e.code}>
                      <td className="px-2 py-2">
                        <div className="font-bold text-odoo-text-strong">{e.name}</div>
                        <div className="font-mono text-[10px] text-odoo-text-muted">
                          {e.code} · ພະແນກ {e.dept}
                        </div>
                      </td>
                      {(["CE", "AC"] as const).map((g) => (
                        <td key={g} className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={values[`${e.code}|${g}`] ?? ""}
                            disabled={!canManage}
                            onChange={(ev) =>
                              setValues((v) => ({ ...v, [`${e.code}|${g}`]: ev.target.value }))
                            }
                            className="odoo-input w-32 text-right font-mono"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right font-mono font-bold text-odoo-text-strong">
                        {ce + ac > 0 ? fmt.format(ce + ac) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-odoo-border bg-odoo-surface-muted font-bold">
                <tr>
                  <td className="px-2 py-2">ລວມທັງໝົດ ({employees.length} ຄົນ)</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt.format(totals.ce)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt.format(totals.ac)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt.format(totals.all)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {canManage ? (
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="odoo-btn odoo-btn-primary"
              >
                {saving ? "ກຳລັງບັນທຶກ…" : `ບັນທຶກເປົ້າ ${MONTHS[month - 1]}/${year}`}
              </button>
              {notice ? (
                <span className={`text-xs font-bold ${notice.ok ? "text-emerald-600" : "text-odoo-danger"}`}>
                  {notice.text}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
