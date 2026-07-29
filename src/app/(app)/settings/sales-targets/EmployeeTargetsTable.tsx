"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { digitsOf, fmt, formatAmountInput, periodLabel } from "@/lib/incentive-period";

// ເປົ້າຂາຍລາຍບຸກຄົນ — the odg_retail_target_employee pivot. Two figures per
// seller, CE (ເຄື່ອງໃຊ້ໄຟຟ້າ / ປະປາ) and AC (ແອ).
//
// Saving is replace-style per (employee, group, month): a blank or 0 REMOVES
// that row. That matters because the target table is also the month's bonus
// roster — /api/reports/special-rewards and the incentives report derive who is
// eligible (AC target → AIR rewards, CE target → CE_SDA) from these rows, so
// clearing a target also drops the person from that reward group.

type Emp = { code: string; name: string; dept: string };
type TargetRow = { employeeCode: string; groupCode: string; target: number };
/** "code|GROUP" → the input's displayed (comma-grouped) text. */
type Values = Record<string, string>;
/** Which product line a seller carries a target for this month. */
type Line = "AC" | "CE" | "BOTH";

type Props = {
  year: number;
  month: number;
  /** Reports the CE+AC sum up so the department card can compare against it. */
  onTotalChange: (total: number) => void;
};

export default function EmployeeTargetsTable({ year, month, onTotalChange }: Props) {
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [values, setValues] = useState<Values>({});
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/incentives/targets?year=${year}&month=${month}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { employees?: Emp[]; targets?: TargetRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? String(res.status));
      const rows = data.employees ?? [];
      const next: Values = {};
      for (const t of data.targets ?? []) {
        if (t.target > 0) {
          next[`${t.employeeCode}|${t.groupCode}`] = formatAmountInput(String(t.target));
        }
      }
      const nextLines: Record<string, Line> = {};
      for (const e of rows) {
        const ac = digitsOf(next[`${e.code}|AC`] ?? "") > 0;
        const ce = digitsOf(next[`${e.code}|CE`] ?? "") > 0;
        // No target yet → offer both inputs rather than guessing a line.
        nextLines[e.code] = ac && ce ? "BOTH" : ac ? "AC" : ce ? "CE" : "BOTH";
      }
      setEmployees(rows);
      setValues(next);
      setLines(nextLines);
    } catch (err) {
      setEmployees([]);
      setValues({});
      setLines({});
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "ໂຫລດເປົ້າລາຍບຸກຄົນບໍ່ສຳເລັດ",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let ce = 0;
    let ac = 0;
    for (const e of employees) {
      ce += digitsOf(values[`${e.code}|CE`] ?? "");
      ac += digitsOf(values[`${e.code}|AC`] ?? "");
    }
    return { ce, ac, all: ce + ac };
  }, [employees, values]);

  useEffect(() => {
    onTotalChange(totals.all);
  }, [totals.all, onTotalChange]);

  // Switching a seller's line clears the group they no longer sell, so saving
  // removes that row (and their slot in the matching reward group).
  function changeLine(code: string, line: Line) {
    setLines((prev) => ({ ...prev, [code]: line }));
    setValues((prev) => {
      const next = { ...prev };
      if (line === "AC") next[`${code}|CE`] = "";
      if (line === "CE") next[`${code}|AC`] = "";
      return next;
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
          target: digitsOf(values[`${e.code}|${g}`] ?? ""),
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
          ? { ok: true, text: `ບັນທຶກເປົ້າລາຍບຸກຄົນ ${periodLabel(year, month)} ແລ້ວ` }
          : { ok: false, text: data.error ?? "ບັນທຶກບໍ່ສຳເລັດ" },
      );
    } catch {
      setNotice({ ok: false, text: "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  const withTarget = employees.filter(
    (e) => digitsOf(values[`${e.code}|CE`] ?? "") + digitsOf(values[`${e.code}|AC`] ?? "") > 0,
  ).length;

  return (
    <section className="rounded-md border border-odoo-border bg-odoo-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-odoo-border px-4 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
            MONTHLY SALES TARGET
          </div>
          <h2 className="mt-0.5 text-sm font-black text-odoo-text-strong">ເປົ້າຂາຍລາຍບຸກຄົນ</h2>
          <p className="mt-1 text-xs text-odoo-text-muted">
            ພະນັກງານຂາຍໜ້າຮ້ານຂົວຫຼວງ (ພະແນກ 205) ທີ່ຍັງເຮັດວຽກຢູ່ ·
            ຄົນທີ່ບໍ່ມີເປົ້າ ຈະບໍ່ຢູ່ໃນກຸ່ມຮັບໂບນັດຂອງເດືອນນີ້
          </p>
        </div>
      </div>

      {/* Roster summary — the same figures the department card compares against. */}
      <div className="grid grid-cols-2 gap-3 border-b border-odoo-border px-4 py-3 sm:grid-cols-4">
        <Stat label="ພະນັກງານທີ່ມີເປົ້າ" value={`${withTarget}/${employees.length}`} unit="ຄົນ" />
        <Stat label="ເປົ້າ CE" value={fmt.format(totals.ce)} unit="ບາດ" />
        <Stat label="ເປົ້າ AC (ແອ)" value={fmt.format(totals.ac)} unit="ບາດ" />
        <Stat label="ເປົ້າລວມ" value={fmt.format(totals.all)} unit="ບາດ" accent />
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : employees.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-odoo-text-muted">
          ບໍ່ພົບພະນັກງານຂາຍ — ກວດວ່າ odg_employee ມີ position_code 13 ໃນພະແນກ 205
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-odoo-surface-muted text-left text-[10px] font-bold uppercase tracking-wider text-odoo-text-muted">
                <tr>
                  <th className="px-4 py-3">ພະນັກງານ</th>
                  <th className="px-4 py-3">ຂາຍ</th>
                  <th className="px-4 py-3">ເປົ້າ CE</th>
                  <th className="px-4 py-3">ເປົ້າ AC (ແອ)</th>
                  <th className="px-4 py-3 text-right">ລວມ</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const line = lines[e.code] ?? "BOTH";
                  const ce = digitsOf(values[`${e.code}|CE`] ?? "");
                  const ac = digitsOf(values[`${e.code}|AC`] ?? "");
                  return (
                    <tr key={e.code} className="border-t border-odoo-border">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-black text-teal-700">
                            {e.name.slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-bold text-odoo-text-strong">{e.name}</div>
                            <div className="text-[11px] text-odoo-text-muted">
                              {e.code} · ພະແນກ {e.dept}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={line}
                          onChange={(ev) => changeLine(e.code, ev.target.value as Line)}
                          aria-label={`ສິນຄ້າທີ່ ${e.name} ຂາຍ`}
                          className="rounded border border-odoo-border px-1.5 py-1 text-xs font-bold"
                        >
                          <option value="CE">CE</option>
                          <option value="AC">AC (ແອ)</option>
                          <option value="BOTH">ທັງສອງ</option>
                        </select>
                      </td>
                      {(["CE", "AC"] as const).map((g) => {
                        const off = (line === "AC" && g === "CE") || (line === "CE" && g === "AC");
                        return (
                          <td key={g} className="px-4 py-2.5">
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder={off ? "—" : "0"}
                              value={off ? "" : values[`${e.code}|${g}`] ?? ""}
                              disabled={off}
                              onChange={(ev) =>
                                setValues((v) => ({
                                  ...v,
                                  [`${e.code}|${g}`]: formatAmountInput(ev.target.value),
                                }))
                              }
                              className={
                                "odoo-input w-full min-w-[110px] text-right font-mono " +
                                (off ? "opacity-40" : "")
                              }
                            />
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right font-mono font-black text-odoo-text-strong">
                        {ce + ac > 0 ? fmt.format(ce + ac) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-odoo-border bg-odoo-surface-muted text-xs font-black text-odoo-text-strong">
                <tr>
                  <td className="px-4 py-3">ລວມທັງໝົດ · {employees.length} ຄົນ</td>
                  <td />
                  <td className="px-4 py-3 font-mono">{fmt.format(totals.ce)}</td>
                  <td className="px-4 py-3 font-mono">{fmt.format(totals.ac)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmt.format(totals.all)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-odoo-border px-4 py-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="odoo-btn odoo-btn-primary"
            >
              {saving ? "ກຳລັງບັນທຶກ…" : `ບັນທຶກເປົ້າ ${periodLabel(year, month)}`}
            </button>
            <span className="text-[11px] text-odoo-text-muted">
              ປ່ອຍວ່າງ ຫຼື ໃສ່ 0 = ລຶບເປົ້າຂອງກຸ່ມນັ້ນ
            </span>
            {notice ? (
              <span
                className={
                  "text-xs font-bold " + (notice.ok ? "text-emerald-600" : "text-odoo-danger")
                }
              >
                {notice.text}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border px-3 py-2 " +
        (accent ? "border-teal-300 bg-teal-50" : "border-odoo-border bg-odoo-surface-muted")
      }
    >
      <div className="text-[9px] font-black uppercase tracking-wide text-odoo-text-muted">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={
            "font-mono text-base font-black " + (accent ? "text-teal-800" : "text-odoo-text-strong")
          }
        >
          {value}
        </span>
        <span className="text-[9px] font-bold text-odoo-text-muted">{unit}</span>
      </div>
    </div>
  );
}
