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
  // Per-employee product line: which group(s) this seller carries a target for.
  // Derived from existing targets on load; the manager can override it.
  const [sells, setSells] = useState<Record<string, "AC" | "CE" | "BOTH">>({});
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
      const nextSells: Record<string, "AC" | "CE" | "BOTH"> = {};
      for (const e of data.employees ?? []) {
        const ac = Number(next[`${e.code}|AC`] || 0) > 0;
        const ce = Number(next[`${e.code}|CE`] || 0) > 0;
        nextSells[e.code] = ac && ce ? "BOTH" : ac ? "AC" : ce ? "CE" : "BOTH";
      }
      setSells(nextSells);
    } catch {
      setEmployees([]);
      setValues({});
      setSells({});
      setNotice({ ok: false, text: "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(year, month);
  }, [load, year, month]);

  // Switching a seller's product line clears the target for the group they no
  // longer sell, so saving removes that group's row (and its roster/reward slot).
  function changeSells(code: string, val: "AC" | "CE" | "BOTH") {
    setSells((s) => ({ ...s, [code]: val }));
    setValues((v) => {
      const nv = { ...v };
      if (val === "AC") nv[`${code}|CE`] = "";
      if (val === "CE") nv[`${code}|AC`] = "";
      return nv;
    });
  }

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
    <section className="odoo-card incentive-editor incentive-editor--targets p-5">
      <div className="incentive-editor-head flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="target-kicker">MONTHLY SALES TARGET</span>
          <h2 className="text-sm font-black text-odoo-text-strong">ເປົ້າຂາຍລາຍບຸກຄົນ</h2>
          <p className="mt-1 text-xs text-odoo-text-muted">
            ກຳນົດເປົ້າ CE ແລະ AC ໃຫ້ພະນັກງານຂາຍແຕ່ລະຄົນ
          </p>
        </div>
        <div className="incentive-filters flex items-end gap-2">
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

      <div className="incentive-stats">
        <div><span>ພະນັກງານ</span><strong>{employees.length}</strong><small>ຄົນ</small></div>
        <div><span>ເປົ້າ CE</span><strong>{fmt.format(totals.ce)}</strong><small>ບາດ</small></div>
        <div><span>ເປົ້າ AC</span><strong>{fmt.format(totals.ac)}</strong><small>ບາດ</small></div>
        <div className="is-accent"><span>ເປົ້າລວມ</span><strong>{fmt.format(totals.all)}</strong><small>ບາດ</small></div>
      </div>

      {loading ? (
        <div className="mt-6 text-center text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : (
        <>
          <div className="target-table-wrap mt-4 overflow-x-auto">
            <table className="target-table w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                  <th>ພະນັກງານ</th><th>ຂາຍ</th><th>ເປົ້າ CE</th><th>ເປົ້າ AC (ແອ)</th><th>ລວມ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-odoo-border">
                {employees.map((e) => {
                  const ce = Number(values[`${e.code}|CE`] || 0);
                  const ac = Number(values[`${e.code}|AC`] || 0);
                  return (
                    <tr key={e.code}>
                      <td>
                        <div className="target-employee">
                          <span>{e.name.slice(0, 1)}</span>
                          <div><strong>{e.name}</strong><small>{e.code} · ພະແນກ {e.dept}</small></div>
                        </div>
                      </td>
                      <td>
                        <select
                          value={sells[e.code] ?? "BOTH"}
                          disabled={!canManage}
                          onChange={(ev) => changeSells(e.code, ev.target.value as "AC" | "CE" | "BOTH")}
                          className="rounded border border-odoo-border px-1.5 py-1 text-xs font-bold"
                          aria-label={`ສິນຄ້າທີ່ ${e.name} ຂາຍ`}
                        >
                          <option value="CE">CE</option>
                          <option value="AC">AC (ແອ)</option>
                          <option value="BOTH">ທັງສອງ</option>
                        </select>
                      </td>
                      {(["CE", "AC"] as const).map((g) => {
                        const line = sells[e.code] ?? "BOTH";
                        const off = (line === "AC" && g === "CE") || (line === "CE" && g === "AC");
                        return (
                          <td key={g}>
                            <label className={`target-cell-input ${off ? "opacity-40" : ""}`}>
                              <input type="number" min={0} placeholder={off ? "—" : "0"}
                                value={off ? "" : values[`${e.code}|${g}`] ?? ""}
                                disabled={!canManage || off}
                                onChange={(ev) => setValues((v) => ({ ...v, [`${e.code}|${g}`]: ev.target.value }))} />
                              <span>฿</span>
                            </label>
                          </td>
                        );
                      })}
                      <td className="target-total">
                        {ce + ac > 0 ? <><strong>{fmt.format(ce + ac)}</strong><span>฿</span></> : <span>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>ລວມທັງໝົດ <small>{employees.length} ຄົນ</small></td>
                  <td />
                  <td>{fmt.format(totals.ce)} ฿</td><td>{fmt.format(totals.ac)} ฿</td><td>{fmt.format(totals.all)} ฿</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {canManage ? (
            <div className="incentive-actions mt-3 flex items-center gap-3">
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
