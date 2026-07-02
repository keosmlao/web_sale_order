"use client";

import { useCallback, useEffect, useState } from "react";

// Commission bases for ຜູ້ຈັດການ (11) / ຫົວໜ້າໜ່ວຍງານ (12) per product group.
// Same rate rule as sellers; the achievement % used is the TEAM's, per group.

const POSITIONS = [
  { code: "13", label: "ພະນັກງານຂາຍ" },
  { code: "11", label: "ຜູ້ຈັດການ" },
  { code: "12", label: "ຫົວໜ້າໜ່ວຍງານ" },
] as const;
const GROUPS = [
  { code: "CE_SDA", label: "CE+SDA" },
  { code: "AIR", label: "AIR" },
  { code: "ALL", label: "ລວມທັງໝົດ" },
  { code: "ONLINE", label: "ອອນລາຍ" },
] as const;

// Cells that don't exist in the workbook: sellers have no ALL line (they get
// a personal-group base), managers/heads have no ONLINE line.
const NA = new Set(["13|ALL", "11|ONLINE", "12|ONLINE"]);

type Line = { positionCode: string; groupCode: string; baseAmount: number };

export default function RoleCommissionEditor({ canManage }: { canManage: boolean }) {
  // value map "pos|group" → amount string (inputs stay strings while editing)
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/incentives/role-commission", { cache: "no-store" });
      const data = (await res.json()) as { lines: Line[] | null };
      if (data.lines === null) {
        setMissing(true);
      } else {
        const next: Record<string, string> = {};
        for (const l of data.lines) next[`${l.positionCode}|${l.groupCode}`] = String(l.baseAmount);
        setValues(next);
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

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const lines: Line[] = [];
      for (const p of POSITIONS)
        for (const g of GROUPS) {
          const raw = values[`${p.code}|${g.code}`];
          if (raw === undefined || raw === "") continue;
          lines.push({ positionCode: p.code, groupCode: g.code, baseAmount: Number(raw) });
        }
      const res = await fetch("/api/incentives/role-commission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setNotice(
        res.ok
          ? { ok: true, text: "ບັນທຶກແລ້ວ — ມີຜົນກັບ report ທັນທີ" }
          : { ok: false, text: data.error ?? "ບັນທຶກບໍ່ສຳເລັດ" },
      );
    } catch {
      setNotice({ ok: false, text: "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="odoo-card mt-4 p-5">
      <h2 className="text-sm font-black text-odoo-text-strong">④ ຖານຄ່າຄອມ ຕາມຕຳແໜ່ງ × ກຸ່ມສິນຄ້າ</h2>
      <p className="mt-1 text-xs text-odoo-text-muted">
        ເກນດຽວກັນທຸກຕຳແໜ່ງ (&lt;80%=0 · 80–99% ປັດລົງ 5% · ≥100% ປັດຂຶ້ນ 5%).
        ພະນັກງານຂາຍ = ຖານກຸ່ມຕົນເອງ × % ບັນລຸ<b>ສ່ວນຕົວ</b> ·
        ຜູ້ຈັດການ/ຫົວໜ້າ = ຜົນບວກທຸກກຸ່ມ × % ບັນລຸ<b>ຂອງທີມ</b> ·
        ອອນລາຍຍັງບໍ່ໃຊ້ (ບໍ່ມີ channel ອອນລາຍໃນ app)
      </p>

      {!loaded ? (
        <div className="mt-4 text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : missing ? (
        <div className="odoo-alert-danger mt-4 px-3 py-2 text-xs font-semibold">
          ຕາຕະລາງຍັງບໍ່ຖືກສ້າງ — ຮັນ: node scripts/apply-sql.mjs sql/add-incentive-role-commission.sql
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                  <th className="px-2 py-2 text-left">ຕຳແໜ່ງ</th>
                  {GROUPS.map((g) => (
                    <th key={g.code} className="px-2 py-2 text-right">{g.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-odoo-border">
                {POSITIONS.map((p) => (
                  <tr key={p.code}>
                    <td className="px-2 py-2 font-bold text-odoo-text-strong">
                      {p.label} <span className="font-mono text-[10px] text-odoo-text-muted">(pos {p.code})</span>
                    </td>
                    {GROUPS.map((g) =>
                      NA.has(`${p.code}|${g.code}`) ? (
                        <td key={g.code} className="px-2 py-2 text-right text-odoo-text-muted">—</td>
                      ) : (
                        <td key={g.code} className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            value={values[`${p.code}|${g.code}`] ?? ""}
                            disabled={!canManage}
                            onChange={(e) =>
                              setValues((v) => ({ ...v, [`${p.code}|${g.code}`]: e.target.value }))
                            }
                            className="odoo-input w-28 text-right font-mono"
                          />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
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
                {saving ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກຖານຄ່າຄອມ"}
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
