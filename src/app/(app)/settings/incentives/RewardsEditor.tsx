"use client";

import { useCallback, useEffect, useState } from "react";

type Reward = {
  rewardCode: string;
  description: string;
  groupCode: string;
  brandCode: string | null;
  targetAmount: number;
  rewardAmount: number;
  splitByShare: boolean;
  isActive: boolean;
};

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export default function RewardsEditor({ canManage }: { canManage: boolean }) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/incentives/rewards", { cache: "no-store" });
      const body = (await res.json()) as { rewards: Reward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRewards(body.rewards);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (code: string, changes: Partial<Reward>) =>
    setRewards((prev) => prev.map((r) => (r.rewardCode === code ? { ...r, ...changes } : r)));

  async function save(reward: Reward) {
    setBusy(reward.rewardCode);
    setError(null);
    try {
      const res = await fetch("/api/incentives/rewards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardCode: reward.rewardCode,
          isActive: reward.isActive,
          targetAmount: reward.targetAmount,
          rewardAmount: reward.rewardAmount,
        }),
      });
      const body = (await res.json()) as { rewards: Reward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      setRewards(body.rewards);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="odoo-card p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">ເງິນພິເສດ (Special Rewards)</h2>
          <p className="text-xs text-odoo-text-muted">ລາງວັນລວມພະແນກ · ຈ່າຍເມື່ອຍອດຂາຍລວມ ≥ ເປົ້າ · ຄໍລຳ ② ໃນລາຍງານ</p>
        </div>
        <button type="button" onClick={() => void load()} className="odoo-btn">ໂຫລດໃໝ່</button>
      </div>

      {error ? <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      <div className="overflow-x-auto">
        <table className="odoo-table min-w-[760px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລາງວັນ</th>
              <th className="px-3 py-2">ຂອບເຂດ</th>
              <th className="px-3 py-2 text-right">ເປົ້າ (฿)</th>
              <th className="px-3 py-2 text-right">ລາງວັນ (฿)</th>
              <th className="px-3 py-2 text-center">ເປີດໃຊ້</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rewards.length === 0 ? (
              <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
            ) : rewards.map((reward) => (
              <tr key={reward.rewardCode}>
                <td className="px-3 py-2">
                  <div className="font-bold text-odoo-text-strong">{reward.description}</div>
                  <div className="font-mono text-[10px] text-odoo-text-muted">{reward.rewardCode}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {reward.brandCode ? `${reward.groupCode} · ${reward.brandCode}` : reward.groupCode}
                  <div className="text-odoo-text-muted">{reward.splitByShare ? "ແບ່ງຕາມ % ຍອດ" : "ຄົງທີ່/ຄົນ"}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="1000" value={reward.targetAmount}
                      onChange={(e) => patch(reward.rewardCode, { targetAmount: Number(e.target.value) })}
                      className="odoo-input w-32 text-right" />
                  ) : <span className="font-mono">{numberFmt.format(reward.targetAmount)}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <input type="number" min="0" step="100" value={reward.rewardAmount}
                      onChange={(e) => patch(reward.rewardCode, { rewardAmount: Number(e.target.value) })}
                      className="odoo-input w-24 text-right" />
                  ) : <span className="font-mono">{numberFmt.format(reward.rewardAmount)}</span>}
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
        ⚠️ ສູດການແບ່ງລາງວັນຍັງບໍ່ໄດ້ຢືນຢັນກັບ Excel — ເປີດໃຊ້ເມື່ອຢືນຢັນເງື່ອນໄຂແລ້ວ.
      </p>
    </section>
  );
}
