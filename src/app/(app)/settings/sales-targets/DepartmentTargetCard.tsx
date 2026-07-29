"use client";

import { useCallback, useEffect, useState } from "react";
import { digitsOf, fmt, formatAmountInput, monthEnd, monthStart, periodLabel } from "@/lib/incentive-period";

// ເປົ້າຂາຍລວມທັງພະແນກ — the app_incentive_special_reward row with
// group_code = 'ALL' and no brand. /api/reports/special-rewards measures the
// whole department's scoped sales against this target_amount, so it is the
// number behind the home-page progress bar.
//
// One row per month: a fresh month starts with nothing here until a manager
// creates it, which is why this card doubles as a create form.

type Reward = {
  rewardCode: string;
  description: string;
  groupCode: string;
  brandCode: string | null;
  targetAmount: number;
  rewardAmount: number;
  splitByShare: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string;
};

type Props = { year: number; month: number; rosterTotal: number };

export default function DepartmentTargetCard({ year, month, rosterTotal }: Props) {
  const [existing, setExisting] = useState<Reward | null>(null);
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [reward, setReward] = useState("");
  const [splitByShare, setSplitByShare] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [from, setFrom] = useState(monthStart(year, month));
  const [to, setTo] = useState(monthEnd(year, month));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/incentives/rewards?year=${year}&month=${month}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { rewards?: Reward[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? String(res.status));
      // The department target is the one ALL-group reward with no brand filter;
      // brand-scoped ALL rewards (e.g. HISENSE) are separate programs.
      const row = (data.rewards ?? []).find((r) => r.groupCode === "ALL" && !r.brandCode) ?? null;
      setExisting(row);
      setDescription(row?.description ?? `ບັນລຸເປົ້າຍອດຂາຍລວມທັງພະແນກ ${periodLabel(year, month)}`);
      setTarget(row ? formatAmountInput(String(row.targetAmount)) : "");
      setReward(row ? formatAmountInput(String(row.rewardAmount)) : "");
      setSplitByShare(row?.splitByShare ?? false);
      setIsActive(row?.isActive ?? true);
      setFrom(row?.effectiveFrom ?? monthStart(year, month));
      setTo(row?.effectiveTo ?? monthEnd(year, month));
    } catch (err) {
      setExisting(null);
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "ໂຫລດເປົ້າລວມພະແນກບໍ່ສຳເລັດ",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const targetAmount = digitsOf(target);
    const rewardAmount = digitsOf(reward);
    if (targetAmount <= 0) {
      setNotice({ ok: false, text: "ເປົ້າລວມພະແນກຕ້ອງໃຫຍ່ກວ່າ 0" });
      return;
    }
    if (!description.trim()) {
      setNotice({ ok: false, text: "ຕ້ອງໃສ່ຄຳອະທິບາຍ" });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/incentives/rewards", {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? {
                rewardCode: existing.rewardCode,
                isActive,
                targetAmount,
                rewardAmount,
                effectiveFrom: from,
                effectiveTo: to,
              }
            : {
                description: description.trim(),
                groupCode: "ALL",
                targetAmount,
                rewardAmount,
                splitByShare,
                isActive,
                effectiveFrom: from,
                effectiveTo: to,
              },
        ),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setNotice({ ok: false, text: data.error ?? `ບັນທຶກບໍ່ສຳເລັດ ${res.status}` });
        return;
      }
      await load();
      setNotice({ ok: true, text: `ບັນທຶກເປົ້າລວມພະແນກ ${periodLabel(year, month)} ແລ້ວ` });
    } catch {
      setNotice({ ok: false, text: "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  const targetNum = digitsOf(target);
  // Managers approve a workbook figure that rarely equals the roster sum
  // exactly — surfacing the gap makes an accidental mismatch obvious.
  const gap = targetNum - rosterTotal;

  return (
    <section className="rounded-md border border-odoo-border bg-odoo-surface">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-odoo-border px-4 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
            DEPARTMENT TARGET
          </div>
          <h2 className="mt-0.5 text-sm font-black text-odoo-text-strong">ເປົ້າຂາຍລວມທັງພະແນກ</h2>
          <p className="mt-1 text-xs text-odoo-text-muted">
            ຕົວເລກທີ່ card “ລາງວັນພິເສດ” ໃນໜ້າຫຼັກ ໃຊ້ວັດຄວາມສຳເລັດຂອງພະແນກ
          </p>
        </div>
        <span
          className={
            "rounded-full px-3 py-1 text-[11px] font-bold " +
            (existing
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-800")
          }
        >
          {existing ? `ມີແລ້ວ · ${existing.rewardCode}` : "ຍັງບໍ່ມີເປົ້າຂອງເດືອນນີ້"}
        </span>
      </div>

      {loading ? (
        <div className="px-4 py-8 text-center text-xs text-odoo-text-muted">ກຳລັງໂຫລດ…</div>
      ) : (
        <div className="px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
              <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                ຄຳອະທິບາຍ {existing ? "(ແກ້ບໍ່ໄດ້ຫຼັງສ້າງແລ້ວ)" : ""}
              </span>
              <input
                type="text"
                value={description}
                disabled={Boolean(existing)}
                onChange={(e) => setDescription(e.target.value)}
                className="odoo-input disabled:bg-odoo-surface-muted disabled:text-odoo-text-muted"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                ເປົ້າລວມ (ບາດ)
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={target}
                onChange={(e) => setTarget(formatAmountInput(e.target.value))}
                placeholder="0"
                className="odoo-input text-right font-mono font-black"
              />
              {rosterTotal > 0 ? (
                <button
                  type="button"
                  onClick={() => setTarget(formatAmountInput(String(rosterTotal)))}
                  className="self-start text-[11px] font-bold text-teal-700 underline decoration-dotted"
                >
                  ໃຊ້ຜົນລວມເປົ້າລາຍບຸກຄົນ ({fmt.format(rosterTotal)})
                </button>
              ) : null}
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                ລາງວັນ (ບາດ)
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={reward}
                onChange={(e) => setReward(formatAmountInput(e.target.value))}
                placeholder="0"
                className="odoo-input text-right font-mono font-black"
              />
              <span className="text-[11px] text-odoo-text-muted">
                {splitByShare ? "ແບ່ງຕາມສັດສ່ວນຍອດຂາຍ" : "ຈ່າຍເທົ່າກັນ ຕໍ່ຄົນ"}
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                ເລີ່ມ
              </span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="odoo-input"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
                ຮອດ
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="odoo-input"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-bold text-odoo-text-strong">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              ຈ່າຍລາງວັນນີ້ (is_active)
            </label>
            {/* split_by_share is fixed at creation — the rewards API updates
                the amounts and dates but not the split rule. */}
            {existing ? null : (
              <label className="flex items-center gap-2 text-xs font-bold text-odoo-text-strong">
                <input
                  type="checkbox"
                  checked={splitByShare}
                  onChange={(e) => setSplitByShare(e.target.checked)}
                />
                ແບ່ງລາງວັນຕາມສັດສ່ວນຍອດຂາຍ
              </label>
            )}
          </div>

          {targetNum > 0 && rosterTotal > 0 && gap !== 0 ? (
            <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] font-semibold text-sky-900">
              ເປົ້າລວມພະແນກ ຕ່າງຈາກຜົນລວມເປົ້າລາຍບຸກຄົນ{" "}
              <strong className="font-mono">
                {gap > 0 ? "+" : "−"}
                {fmt.format(Math.abs(gap))}
              </strong>{" "}
              ບາດ — ຖ້າເປັນຄ່າທີ່ອະນຸມັດຕາມ workbook ແລ້ວ ບໍ່ຕ້ອງແກ້.
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="odoo-btn odoo-btn-primary"
            >
              {saving
                ? "ກຳລັງບັນທຶກ…"
                : existing
                  ? "ບັນທຶກການແກ້ໄຂ"
                  : `ສ້າງເປົ້າ ${periodLabel(year, month)}`}
            </button>
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
        </div>
      )}
    </section>
  );
}
