"use client";

import { useCallback, useEffect, useState } from "react";

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
};

export default function UnitRewardsEditor({ canManage }: { canManage: boolean }) {
  const [rewards, setRewards] = useState<UnitReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/incentives/unit-rewards", { cache: "no-store" });
      const body = (await res.json()) as { rewards: UnitReward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRewards(body.rewards);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => void load());
  }, [load]);

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
          brandCode: reward.brandCode ?? "",
          itemMatch: reward.itemMatch ?? "",
          lowMinQty: reward.lowMinQty,
          lowReward: reward.lowReward,
          highMinQty: reward.highMinQty,
          highReward: reward.highReward,
        }),
      });
      const body = (await res.json()) as { rewards: UnitReward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRewards(body.rewards);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
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

      <div className="incentive-table-wrap overflow-x-auto">
        <table className="odoo-table incentive-data-table min-w-[880px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລາງວັນ</th>
              <th className="px-3 py-2">ແບຮນດ໌</th>
              <th className="px-3 py-2">ຮຸ່ນ (ລະຫັດ/ຊື່)</th>
              <th className="px-3 py-2 text-right">ຂັ້ນຕ່ຳ ≥ (ຊຸດ)</th>
              <th className="px-3 py-2 text-right">฿/ຊຸດ</th>
              <th className="px-3 py-2 text-right">ຂັ້ນສູງ ≥ (ຊຸດ)</th>
              <th className="px-3 py-2 text-right">฿/ຊຸດ</th>
              <th className="px-3 py-2 text-center">ເປີດໃຊ້</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 9 : 8} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rewards.length === 0 ? (
              <tr><td colSpan={canManage ? 9 : 8} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
            ) : rewards.map((reward) => (
              <tr key={reward.rewardCode}>
                <td className="px-3 py-2">
                  <div className="font-bold text-odoo-text-strong">{reward.description}</div>
                  <div className="font-mono text-[10px] text-odoo-text-muted">
                    {reward.rewardCode} · {reward.groupCode}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <input type="text" value={reward.brandCode ?? ""} placeholder="ເຊັ່ນ MITSUBISHI"
                      onChange={(e) => patch(reward.rewardCode, { brandCode: e.target.value })}
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
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={reward.isActive} disabled={!canManage}
                    onChange={(e) => patch(reward.rewardCode, { isActive: e.target.checked })}
                    className="h-4 w-4 accent-odoo-primary" />
                </td>
                {canManage ? (
                  <td className="px-3 py-2 text-right">
                    <button type="button" disabled={busy === reward.rewardCode}
                      onClick={() => void save(reward)}
                      className="odoo-btn odoo-btn-primary disabled:opacity-40">ບັນທຶກ</button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-odoo-text-muted">
        ໃສ່ <b>ແບຮນດ໌</b> (ນັບແອທຸກຮຸ່ນຂອງແບຮນດ໌ນັ້ນ) ຫຼື <b>ຮຸ່ນ</b> (ນັບສະເພາະຮຸ່ນທີ່ລະບຸ — ໃສ່ຮຸ່ນແລ້ວ
        ແບຮນດ໌ຈະຖືກເບິ່ງຂ້າມ) · ລາງວັນ 0 ບາດ = ໂຄງການພັກໄວ້ (ບໍ່ສະແດງໜ້າຫຼັກ)
      </p>
    </section>
  );
}
