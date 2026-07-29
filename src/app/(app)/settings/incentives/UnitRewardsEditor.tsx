"use client";

import { useCallback, useEffect, useState } from "react";
import BrandSelect from "@/components/BrandSelect";

// Editor for unit-count spiffs (workbook ④ brand / ⑤ pushed model):
// per-person tiered per-unit rewards on air sets / a specified model.
type UnitReward = {
  rewardCode: string;
  description: string;
  groupCode: string;
  brandCode: string | null;
  itemMatch: string | null;
  lowMinQty: number;
  lowReward: number;
  highMinQty: number;
  highReward: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string;
};

function monthRange(year: number, month: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    effectiveFrom: `${year}-${pad(month)}-01`,
    effectiveTo: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`,
  };
}

const emptyDraft = (year: number, month: number) => ({
  description: "",
  groupCode: "AIR",
  brandCode: "",
  itemMatch: "",
  lowMinQty: "",
  lowReward: "",
  highMinQty: "",
  highReward: "",
  ...monthRange(year, month),
});

export default function UnitRewardsEditor({ canManage, year, month }: { canManage: boolean; year: number; month: number }) {
  const [rewards, setRewards] = useState<UnitReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => emptyDraft(year, month));
  const [brandData, setBrandData] = useState<{ air: string[]; other: string[] }>({ air: [], other: [] });
  const allBrands = Array.from(new Set([...brandData.air, ...brandData.other])).sort();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/unit-rewards?year=${year}&month=${month}`, { cache: "no-store" });
      const body = (await res.json()) as { rewards: UnitReward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRewards(body.rewards);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    Promise.resolve().then(() => void load());
  }, [load]);

  useEffect(() => {
    fetch("/api/incentives/brands", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { air: [], other: [] }))
      .then((body: { air?: string[]; other?: string[] }) =>
        setBrandData({ air: body.air ?? [], other: body.other ?? [] }))
      .catch(() => setBrandData({ air: [], other: [] }));
  }, []);

  const patch = (code: string, changes: Partial<UnitReward>) =>
    setRewards((prev) => prev.map((r) => (r.rewardCode === code ? { ...r, ...changes } : r)));

  async function save(reward: UnitReward) {
    setBusy(reward.rewardCode);
    setError(null);
    try {
      const res = await fetch("/api/incentives/unit-rewards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardCode: reward.rewardCode,
          isActive: reward.isActive,
          groupCode: reward.groupCode,
          brandCode: reward.brandCode ?? "",
          itemMatch: reward.itemMatch ?? "",
          lowMinQty: reward.lowMinQty,
          lowReward: reward.lowReward,
          highMinQty: reward.highMinQty,
          highReward: reward.highReward,
          effectiveFrom: reward.effectiveFrom,
          effectiveTo: reward.effectiveTo,
        }),
      });
      const body = (await res.json()) as { rewards: UnitReward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("__new__");
    setError(null);
    try {
      const res = await fetch("/api/incentives/unit-rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: draft.description,
          groupCode: draft.groupCode,
          brandCode: draft.brandCode,
          itemMatch: draft.itemMatch,
          lowMinQty: Number(draft.lowMinQty) || 0,
          lowReward: Number(draft.lowReward) || 0,
          highMinQty: Number(draft.highMinQty) || 0,
          highReward: Number(draft.highReward) || 0,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo,
        }),
      });
      const body = (await res.json()) as { rewards: UnitReward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      await load();
      setDraft(emptyDraft(year, month));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove(code: string) {
    if (!window.confirm("ລຶບໂຄງການຕໍ່ຊຸດນີ້?")) return;
    setBusy(code);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/unit-rewards?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { rewards: UnitReward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="odoo-card incentive-editor incentive-editor--units p-4">
      <div className="incentive-editor-head mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">
            ລາງວັນຕໍ່ຊຸດ (Unit Rewards)
          </h2>
          <p className="text-xs text-odoo-text-muted">
            ຄໍລຳ ④/⑤ ໃນ workbook · ນັບຊຸດຂອງແຕ່ລະຄົນ (ແອ [C]+[H] = 1 ຊຸດ) ·
            ຮອດຂັ້ນສູງ ທຸກຊຸດຈ່າຍເລດສູງ
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="odoo-btn">ໂຫລດໃໝ່</button>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">
          {error}
        </div>
      ) : null}

      <div className="incentive-stats incentive-stats--compact">
        <div><span>ໂຄງການຕໍ່ຊຸດ</span><strong>{rewards.length}</strong><small>ໂຄງການ</small></div>
        <div className="is-accent"><span>ເປີດໃຊ້</span><strong>{rewards.filter((reward) => reward.isActive).length}</strong><small>ໂຄງການ</small></div>
      </div>

      {/* Brand suggestions for the in-row edit inputs (the add-form uses the
          BrandSelect combobox, which can't live inside the scroll container). */}
      <datalist id="unit-brand-list">
        {allBrands.map((b) => <option key={b} value={b} />)}
      </datalist>

      <div className="incentive-table-wrap overflow-x-auto">
        <table className="odoo-table incentive-data-table min-w-[1120px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລາງວັນ</th>
              <th className="px-3 py-2">ກຸ່ມ</th>
              <th className="px-3 py-2">ແບຮນດ໌</th>
              <th className="px-3 py-2">ຮຸ່ນ (ລະຫັດ/ຊື່)</th>
              <th className="px-3 py-2 text-right">ຂັ້ນຕ່ຳ ≥ (ຊຸດ)</th>
              <th className="px-3 py-2 text-right">฿/ຊຸດ</th>
              <th className="px-3 py-2 text-right">ຂັ້ນສູງ ≥ (ຊຸດ)</th>
              <th className="px-3 py-2 text-right">฿/ຊຸດ</th>
              <th className="px-3 py-2">ໄລຍະນຳໃຊ້</th>
              <th className="px-3 py-2 text-center">ເປີດໃຊ້</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 11 : 10} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rewards.length === 0 ? (
              <tr><td colSpan={canManage ? 11 : 10} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
            ) : rewards.map((reward) => (
              <tr key={reward.rewardCode}>
                <td className="px-3 py-2">
                  <div className="font-bold text-odoo-text-strong">{reward.description}</div>
                  <div className="font-mono text-[10px] text-odoo-text-muted">{reward.rewardCode}</div>
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <select value={reward.groupCode}
                      onChange={(e) => patch(reward.rewardCode, { groupCode: e.target.value })}
                      className="odoo-input w-28 text-xs">
                      <option value="AIR">AIR</option>
                      <option value="CE_SDA">CE_SDA</option>
                    </select>
                  ) : <span className="font-mono text-xs">{reward.groupCode}</span>}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <input type="text" value={reward.brandCode ?? ""} placeholder="ເຊັ່ນ MITSUBISHI" list="unit-brand-list"
                      onChange={(e) => patch(reward.rewardCode, { brandCode: e.target.value.toUpperCase() })}
                      className="odoo-input w-32 uppercase" />
                  ) : <span className="font-mono text-xs">{reward.brandCode ?? "—"}</span>}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <input type="text" value={reward.itemMatch ?? ""} placeholder="ລະຫັດ ຫຼື ຊື່ຮຸ່ນ"
                      onChange={(e) => patch(reward.rewardCode, { itemMatch: e.target.value })}
                      className="odoo-input w-36" />
                  ) : <span className="font-mono text-xs">{reward.itemMatch ?? "—"}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="1" value={reward.lowMinQty}
                      onChange={(e) => patch(reward.rewardCode, { lowMinQty: Number(e.target.value) })}
                      className="odoo-input w-20 text-right" />
                  ) : <span className="font-mono">{reward.lowMinQty}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="50" value={reward.lowReward}
                      onChange={(e) => patch(reward.rewardCode, { lowReward: Number(e.target.value) })}
                      className="odoo-input w-24 text-right" />
                  ) : <span className="font-mono">{reward.lowReward}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="1" value={reward.highMinQty}
                      onChange={(e) => patch(reward.rewardCode, { highMinQty: Number(e.target.value) })}
                      className="odoo-input w-20 text-right" />
                  ) : <span className="font-mono">{reward.highMinQty}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="50" value={reward.highReward}
                      onChange={(e) => patch(reward.rewardCode, { highReward: Number(e.target.value) })}
                      className="odoo-input w-24 text-right" />
                  ) : <span className="font-mono">{reward.highReward}</span>}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <div className="grid gap-1">
                      <input type="date" value={reward.effectiveFrom}
                        onChange={(e) => patch(reward.rewardCode, { effectiveFrom: e.target.value })}
                        className="odoo-input w-36 text-xs" />
                      <input type="date" value={reward.effectiveTo}
                        onChange={(e) => patch(reward.rewardCode, { effectiveTo: e.target.value })}
                        className="odoo-input w-36 text-xs" />
                    </div>
                  ) : <span className="text-xs">{reward.effectiveFrom}<br />{reward.effectiveTo}</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={reward.isActive} disabled={!canManage}
                    onChange={(e) => patch(reward.rewardCode, { isActive: e.target.checked })}
                    className="h-4 w-4 accent-odoo-primary" />
                </td>
                {canManage ? (
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button type="button" disabled={busy === reward.rewardCode}
                        onClick={() => void save(reward)}
                        className="odoo-btn odoo-btn-primary disabled:opacity-40">ບັນທຶກ</button>
                      <button type="button" disabled={busy === reward.rewardCode}
                        onClick={() => void remove(reward.rewardCode)}
                        className="odoo-btn text-rose-600 disabled:opacity-40">ລຶບ</button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage ? (
        <div className="mt-3 rounded-lg border border-odoo-border bg-odoo-surface-muted p-3">
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-odoo-text-strong">
            ເພີ່ມໂຄງການຕໍ່ຊຸດໃໝ່
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input placeholder="ຄຳອະທິບາຍ" value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="odoo-input min-w-[150px] flex-1" />
            <select value={draft.groupCode}
              onChange={(e) => setDraft({ ...draft, groupCode: e.target.value })}
              className="odoo-input w-28">
              <option value="AIR">AIR (ແອ)</option>
              <option value="CE_SDA">CE_SDA</option>
            </select>
            <BrandSelect value={draft.brandCode} placeholder="ແບຮນດ໌"
              options={draft.groupCode === "AIR" ? brandData.air : brandData.other}
              onChange={(v) => setDraft({ ...draft, brandCode: v })} wrapClassName="w-28" />
            <input placeholder="ຮຸ່ນ (ທາງເລືອກ)" value={draft.itemMatch}
              onChange={(e) => setDraft({ ...draft, itemMatch: e.target.value })}
              className="odoo-input w-32" />
            <input type="date" value={draft.effectiveFrom}
              onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
              className="odoo-input w-36" />
            <input type="date" value={draft.effectiveTo}
              onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })}
              className="odoo-input w-36" />
            <input type="number" min="0" step="1" placeholder="ຂັ້ນຕ່ຳ" value={draft.lowMinQty}
              onChange={(e) => setDraft({ ...draft, lowMinQty: e.target.value })}
              className="odoo-input w-20 text-right" />
            <input type="number" min="0" step="50" placeholder="฿/ຊຸດ" value={draft.lowReward}
              onChange={(e) => setDraft({ ...draft, lowReward: e.target.value })}
              className="odoo-input w-24 text-right" />
            <input type="number" min="0" step="1" placeholder="ຂັ້ນສູງ" value={draft.highMinQty}
              onChange={(e) => setDraft({ ...draft, highMinQty: e.target.value })}
              className="odoo-input w-20 text-right" />
            <input type="number" min="0" step="50" placeholder="฿/ຊຸດ" value={draft.highReward}
              onChange={(e) => setDraft({ ...draft, highReward: e.target.value })}
              className="odoo-input w-24 text-right" />
            <button type="button"
              disabled={busy === "__new__" || !draft.description.trim() || (!draft.brandCode.trim() && !draft.itemMatch.trim())}
              onClick={() => void create()}
              className="odoo-btn odoo-btn-primary disabled:opacity-40">ເພີ່ມ</button>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-odoo-text-muted">
        ໃສ່ <b>ແບຮນດ໌</b> (ນັບແອທຸກຮຸ່ນຂອງແບຮນດ໌ນັ້ນ) ຫຼື <b>ຮຸ່ນ</b> (ນັບສະເພາະຮຸ່ນທີ່ລະບຸ — ໃສ່ຮຸ່ນແລ້ວ
        ແບຮນດ໌ຈະຖືກເບິ່ງຂ້າມ) · ລາງວັນ 0 ບາດ = ໂຄງການພັກໄວ້ (ບໍ່ສະແດງໜ້າຫຼັກ)
      </p>
    </section>
  );
}
