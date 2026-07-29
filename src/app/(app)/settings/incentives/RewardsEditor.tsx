"use client";

import { useCallback, useEffect, useState } from "react";
import BrandSelect from "@/components/BrandSelect";

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

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

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
  targetAmount: "",
  rewardAmount: "",
  splitByShare: false,
  ...monthRange(year, month),
});

export default function RewardsEditor({ canManage, year, month }: { canManage: boolean; year: number; month: number }) {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => emptyDraft(year, month));
  const [brandData, setBrandData] = useState<{ air: string[]; other: string[] }>({ air: [], other: [] });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/rewards?year=${year}&month=${month}`, { cache: "no-store" });
      const body = (await res.json()) as { rewards: Reward[]; error?: string };
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
          effectiveFrom: reward.effectiveFrom,
          effectiveTo: reward.effectiveTo,
        }),
      });
      const body = (await res.json()) as { rewards: Reward[]; error?: string };
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
      const res = await fetch("/api/incentives/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: draft.description,
          groupCode: draft.groupCode,
          brandCode: draft.brandCode,
          targetAmount: Number(draft.targetAmount) || 0,
          rewardAmount: Number(draft.rewardAmount) || 0,
          splitByShare: draft.splitByShare,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo,
        }),
      });
      const body = (await res.json()) as { rewards: Reward[]; error?: string };
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
    if (!window.confirm("ລຶບໂຄງການລາງວັນນີ້?")) return;
    setBusy(code);
    setError(null);
    try {
      const res = await fetch(`/api/incentives/rewards?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const body = (await res.json()) as { rewards: Reward[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="odoo-card incentive-editor incentive-editor--rewards p-4">
      <div className="incentive-editor-head mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-odoo-text-strong">ເງິນພິເສດ (Special Rewards)</h2>
          <p className="text-xs text-odoo-text-muted">ລາງວັນລວມພະແນກ · ຈ່າຍເມື່ອຍອດຂາຍລວມ ≥ ເປົ້າ · ຄໍລຳ ② ໃນລາຍງານ</p>
        </div>
        <button type="button" onClick={() => void load()} className="odoo-btn">ໂຫລດໃໝ່</button>
      </div>

      {error ? <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-odoo-danger">{error}</div> : null}

      <div className="incentive-stats incentive-stats--compact">
        <div><span>ລາງວັນທັງໝົດ</span><strong>{rewards.length}</strong><small>ລາຍການ</small></div>
        <div className="is-accent"><span>ກຳລັງໃຊ້ງານ</span><strong>{rewards.filter((reward) => reward.isActive).length}</strong><small>ລາຍການ</small></div>
      </div>

      <div className="incentive-table-wrap overflow-x-auto">
        <table className="odoo-table incentive-data-table min-w-[760px]">
          <thead>
            <tr>
              <th className="px-3 py-2">ລາງວັນ</th>
              <th className="px-3 py-2">ຂອບເຂດ</th>
              <th className="px-3 py-2">ໄລຍະນຳໃຊ້</th>
              <th className="px-3 py-2 text-right">ເປົ້າ (฿)</th>
              <th className="px-3 py-2 text-right">ລາງວັນ (฿)</th>
              <th className="px-3 py-2 text-center">ເປີດໃຊ້</th>
              {canManage ? <th className="px-3 py-2 text-right">ຈັດການ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-odoo-border">
            {loading ? (
              <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-8 text-center text-odoo-text-muted">ກຳລັງໂຫລດ…</td></tr>
            ) : rewards.length === 0 ? (
              <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-8 text-center text-odoo-text-muted">ບໍ່ມີຂໍ້ມູນ</td></tr>
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
            ເພີ່ມໂຄງການໃໝ່
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input placeholder="ຄຳອະທິບາຍ" value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="odoo-input min-w-[160px] flex-1" />
            <select value={draft.groupCode}
              onChange={(e) => setDraft({ ...draft, groupCode: e.target.value })}
              className="odoo-input w-32">
              <option value="AIR">AIR (ແອ)</option>
              <option value="CE_SDA">CE_SDA</option>
              <option value="ALL">ALL (ລວມທັງໝົດ)</option>
            </select>
            <BrandSelect value={draft.brandCode} placeholder="ແບຮນດ໌ (ທາງເລືອກ)"
              options={draft.groupCode === "AIR" ? brandData.air : brandData.other}
              onChange={(v) => setDraft({ ...draft, brandCode: v })} wrapClassName="w-32" />
            <input type="date" value={draft.effectiveFrom}
              onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
              className="odoo-input w-36" />
            <input type="date" value={draft.effectiveTo}
              onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })}
              className="odoo-input w-36" />
            <input type="number" min="0" step="1000" placeholder="ເປົ້າ ฿" value={draft.targetAmount}
              onChange={(e) => setDraft({ ...draft, targetAmount: e.target.value })}
              className="odoo-input w-28 text-right" />
            <input type="number" min="0" step="100" placeholder="ລາງວັນ ฿" value={draft.rewardAmount}
              onChange={(e) => setDraft({ ...draft, rewardAmount: e.target.value })}
              className="odoo-input w-28 text-right" />
            <label className="flex items-center gap-1 text-xs font-semibold text-odoo-text-muted">
              <input type="checkbox" checked={draft.splitByShare}
                onChange={(e) => setDraft({ ...draft, splitByShare: e.target.checked })}
                className="h-4 w-4 accent-odoo-primary" />
              ແບ່ງຕາມ %
            </label>
            <button type="button" disabled={busy === "__new__" || !draft.description.trim()}
              onClick={() => void create()}
              className="odoo-btn odoo-btn-primary disabled:opacity-40">ເພີ່ມ</button>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-xs text-odoo-text-muted">
        ລາງວັນຖືກນຳໃຊ້ສະເພາະເດືອນ/ຊ່ວງວັນທີ່ກຳນົດ ເພື່ອບໍ່ໃຫ້ rule ເດືອນໃໝ່ປ່ຽນລາຍງານເກົ່າ.
      </p>
    </section>
  );
}
