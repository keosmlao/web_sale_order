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
type HistoryEntry = {
  id: string;
  positionCode: string;
  groupCode: string;
  oldAmount: number;
  newAmount: number;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
};

const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export default function RoleCommissionEditor({ canManage }: { canManage: boolean }) {
  // value map "pos|group" → amount string (inputs stay strings while editing)
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [auditAvailable, setAuditAvailable] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/incentives/role-commission", { cache: "no-store" });
      const data = (await res.json()) as { lines: Line[] | null; history?: HistoryEntry[]; auditAvailable?: boolean };
      if (data.lines === null) {
        setMissing(true);
      } else {
        const next: Record<string, string> = {};
        for (const l of data.lines) next[`${l.positionCode}|${l.groupCode}`] = String(l.baseAmount);
        setValues(next);
        setMissing(false);
        setHistory(data.history ?? []);
        setAuditAvailable(data.auditAvailable !== false);
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
      if (res.ok) await load();
    } catch {
      setNotice({ ok: false, text: "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="odoo-card incentive-editor incentive-editor--matrix mt-4 p-5">
      <div className="commission-heading">
        <div>
          <span className="commission-kicker">03 / COMMISSION MATRIX</span>
          <h2 className="text-sm font-black text-odoo-text-strong">ກຳນົດຖານຄ່າຄອມ</h2>
          <p className="mt-1 text-xs text-odoo-text-muted">ເລືອກອັດຕາຕາມຕຳແໜ່ງ ແລະ ປະເພດຍອດຂາຍ</p>
        </div>
        <div className="commission-rules" aria-label="ເກນການຄຳນວນ">
          <span>ຖານ × ອັດຕາ (ຕາມ<b>ຂັ້ນຄ່າຄອມ</b>)</span>
          <span>ອັດຕາປັດ ຕັ້ງຢູ່ <b>04 ຂັ້ນຄ່າຄອມ</b> ຂ້າງລຸ່ມ</span>
        </div>
      </div>

      {!loaded ? (
        <div className="mt-4 text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : missing ? (
        <div className="odoo-alert-danger mt-4 px-3 py-2 text-xs font-semibold">
          ຕາຕະລາງຍັງບໍ່ຖືກສ້າງ — ຮັນ: node scripts/apply-sql.mjs sql/add-incentive-role-commission.sql
        </div>
      ) : (
        <>
          <div className="commission-table-wrap mt-4 overflow-x-auto">
            <table className="commission-table">
              <thead>
                <tr>
                  <th>ຕຳແໜ່ງ</th>
                  {GROUPS.map((group) => <th key={group.code}>{group.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {POSITIONS.map((position) => (
                  <tr key={position.code}>
                    <td>
                      <div className="commission-position">
                        <span className="commission-role-number">{position.label.slice(0, 1)}</span>
                        <div>
                          <strong>{position.label}</strong>
                          <small>POS {position.code} · {position.code === "13" ? "ຜົນງານສ່ວນຕົວ" : "ຜົນງານຂອງທີມ"}</small>
                        </div>
                      </div>
                    </td>
                    {GROUPS.map((group) => {
                      const key = `${position.code}|${group.code}`;
                      return (
                        <td key={group.code}>
                          {NA.has(key) ? (
                            <span className="commission-na">ບໍ່ນຳໃຊ້</span>
                          ) : (
                            <label className="commission-table-input">
                              <input
                                type="number"
                                min={0}
                                value={values[key] ?? ""}
                                disabled={!canManage}
                                onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                                aria-label={`${position.label} ${group.label}`}
                              />
                              <span>฿</span>
                            </label>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <div className="incentive-actions mt-3 flex items-center gap-3">
              <button type="button" onClick={() => setHistoryOpen((open) => !open)} className="odoo-btn">
                {historyOpen ? "ປິດປະຫວັດ" : `ເບິ່ງປະຫວັດ (${history.length})`}
              </button>
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
          {historyOpen ? (
            <div className="commission-history">
              <div className="commission-history-head">
                <div><strong>ປະຫວັດການແກ້ໄຂ</strong><span>ສະແດງ 100 ລາຍການຫຼ້າສຸດ</span></div>
                <span className={auditAvailable ? "is-ready" : "is-missing"}>{auditAvailable ? "ກຳລັງບັນທຶກ" : "ຍັງບໍ່ເປີດໃຊ້"}</span>
              </div>
              {!auditAvailable ? (
                <p className="commission-history-empty">ກະລຸນາຮັນ sql/add-incentive-role-commission-audit.sql</p>
              ) : history.length === 0 ? (
                <p className="commission-history-empty">ຍັງບໍ່ມີການແກ້ໄຂ</p>
              ) : (
                <div className="overflow-x-auto">
                  <table>
                    <thead><tr><th>ວັນທີ/ເວລາ</th><th>ຜູ້ແກ້</th><th>ຕຳແໜ່ງ</th><th>ກຸ່ມ</th><th>ຄ່າເກົ່າ</th><th>ຄ່າໃໝ່</th></tr></thead>
                    <tbody>{history.map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Intl.DateTimeFormat("lo-LA", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Vientiane" }).format(new Date(entry.changedAt))}</td>
                        <td><strong>{entry.changedByName || entry.changedBy || "—"}</strong><small>{entry.changedBy}</small></td>
                        <td>{POSITIONS.find((position) => position.code === entry.positionCode)?.label ?? entry.positionCode}</td>
                        <td>{GROUPS.find((group) => group.code === entry.groupCode)?.label ?? entry.groupCode}</td>
                        <td className="history-amount">{amountFormat.format(entry.oldAmount)} ฿</td>
                        <td className="history-amount is-new">{amountFormat.format(entry.newAmount)} ฿</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
