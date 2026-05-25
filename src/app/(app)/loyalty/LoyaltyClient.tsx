"use client";

import { useState } from "react";

export type LoyaltyConfig = {
  id: string;
  earnKipPerPoint: number;
  redeemPointsPerKip: number;
  minRedeemPoints: number;
  pointName: string | null;
  isActive: boolean;
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const moneyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

export default function LoyaltyClient({
  initialConfig,
  canManage,
}: {
  initialConfig: LoyaltyConfig | null;
  canManage: boolean;
}) {
  const [config, setConfig] = useState<LoyaltyConfig | null>(initialConfig);
  const [isActive, setIsActive] = useState(initialConfig?.isActive ?? true);
  const [earnKipPerPoint, setEarnKipPerPoint] = useState(
    initialConfig?.earnKipPerPoint?.toString() ?? "70000",
  );
  const [redeemPointsPerKip, setRedeemPointsPerKip] = useState(
    initialConfig?.redeemPointsPerKip?.toString() ?? "0",
  );
  const [minRedeemPoints, setMinRedeemPoints] = useState(
    initialConfig?.minRedeemPoints?.toString() ?? "0",
  );
  const [pointName, setPointName] = useState(initialConfig?.pointName ?? "");
  const [note, setNote] = useState(initialConfig?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function save() {
    if (!canManage || saving) return;
    setError(null);
    setSavedAt(null);
    const earn = Number(earnKipPerPoint);
    if (!Number.isFinite(earn) || earn <= 0) {
      setError("ກີບຕໍ່ແຕ້ມ ຕ້ອງເປັນຕົວເລກ > 0");
      return;
    }
    const redeem = Number(redeemPointsPerKip);
    if (!Number.isFinite(redeem) || redeem < 0) {
      setError("ແຕ້ມຕໍ່ກີບ (redeem) ຕ້ອງເປັນຕົວເລກ ≥ 0");
      return;
    }
    const minRedeem = Number(minRedeemPoints);
    if (!Number.isFinite(minRedeem) || minRedeem < 0) {
      setError("ແຕ້ມຂັ້ນຕ່ຳໃນການແລກ ຕ້ອງເປັນຕົວເລກ ≥ 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/loyalty/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          earnKipPerPoint: earn,
          redeemPointsPerKip: redeem,
          minRedeemPoints: minRedeem,
          pointName: pointName.trim() || undefined,
          note: note.trim() || undefined,
          isActive,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ບັນທຶກຜິດພາດ ${res.status}`);
        return;
      }
      const next = data.config as LoyaltyConfig;
      setConfig(next);
      setSavedAt(next.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  const earnNum = Number(earnKipPerPoint);
  const earnExample = Number.isFinite(earnNum) && earnNum > 0
    ? `ຊື້ ${moneyFmt.format(earnNum)} ກີບ = 1 ແຕ້ມສະສົມ`
    : "—";
  const redeemNum = Number(redeemPointsPerKip);
  const redeemExample =
    Number.isFinite(redeemNum) && redeemNum > 0
      ? `${moneyFmt.format(redeemNum)} ແຕ້ມ = 1 ກີບ (ໃຊ້ແຕ້ມຫຼຸດເງິນຈ່າຍ)`
      : "ບໍ່ເປີດໃຊ້ການແລກ — ໃສ່ 0";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ສະມາຊິກສະສົມແຕ້ມ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ກຳນົດອັດຕາການສະສົມແຕ້ມຈາກຍອດຊື້.
          ການເຄື່ອນໄຫວແຕ່ລະຄັ້ງສ້າງເປັນຮຸ່ນໃໝ່ ແລະ ປິດໃຊ້ຮຸ່ນເກົ່າ.
        </p>
      </header>

      {!canManage ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          ສະຖານະອ່ານຢ່າງດຽວ — ສະເພາະຫົວໜ້າ/ຜູ້ຈັດການ ສາມາດແກ້ໄຂໄດ້.
        </div>
      ) : null}

      <div className="rounded-md border border-odoo-border bg-odoo-surface">
        <div className="border-b border-odoo-border px-4 py-3">
          <div className="text-sm font-bold text-odoo-text-strong">
            ອັດຕາສະສົມແຕ້ມ
          </div>
        </div>
        <div className="flex flex-col gap-3 border-b border-odoo-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-odoo-text-strong">
              ສະຖານະການໃຊ້ງານ
            </div>
            <div className="mt-1 text-xs text-odoo-text-muted">
              ປິດໃຊ້ແລ້ວ ການອອກ sale order ທັງ web ແລະ app ຈະບໍ່ຄຳນວນແຕ້ມ.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            disabled={!canManage || saving}
            onClick={() => setIsActive((value) => !value)}
            className={
              "inline-flex h-9 min-w-28 items-center justify-between gap-2 rounded-full border px-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60 " +
              (isActive
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-odoo-border bg-odoo-surface-muted text-odoo-text-muted")
            }
          >
            <span className="pl-2">{isActive ? "ເປີດໃຊ້" : "ປິດໃຊ້"}</span>
            <span
              className={
                "h-6 w-6 rounded-full bg-white shadow-sm transition " +
                (isActive ? "translate-x-0" : "-order-1")
              }
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="odoo-label">ຊື່ແຕ້ມ (ສະແດງໃຫ້ລູກຄ້າເຫັນ)</span>
            <input
              type="text"
              value={pointName}
              onChange={(e) => setPointName(e.target.value)}
              placeholder="ເຊັ່ນ: ແຕ້ມ ODG"
              disabled={!canManage || saving}
              maxLength={50}
              className="odoo-input"
            />
          </label>
          <label className="grid gap-1">
            <span className="odoo-label">ຍອດຊື້ຕໍ່ 1 ແຕ້ມ</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={earnKipPerPoint}
              onChange={(e) => setEarnKipPerPoint(e.target.value)}
              disabled={!canManage || saving}
              className="odoo-input"
            />
            <span className="text-[11px] text-emerald-700">{earnExample}</span>
          </label>
          <label className="grid gap-1">
            <span className="odoo-label">ແຕ້ມຕໍ່ 1 ກີບ (ແລກ)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              value={redeemPointsPerKip}
              onChange={(e) => setRedeemPointsPerKip(e.target.value)}
              disabled={!canManage || saving}
              className="odoo-input"
            />
            <span className="text-[11px] text-emerald-700">{redeemExample}</span>
          </label>
          <label className="grid gap-1">
            <span className="odoo-label">ແຕ້ມຂັ້ນຕ່ຳໃນການແລກ</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={minRedeemPoints}
              onChange={(e) => setMinRedeemPoints(e.target.value)}
              disabled={!canManage || saving}
              className="odoo-input"
            />
            <span className="text-[11px] text-odoo-text-muted">
              ລູກຄ້າຕ້ອງມີຄະແນນຢ່າງໜ້ອຍເທົ່ານີ້ກ່ອນຈິ່ງແລກໄດ້
            </span>
          </label>
          <label className="grid gap-1 sm:col-span-2">
            <span className="odoo-label">ໝາຍເຫດ (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              disabled={!canManage || saving}
              className="odoo-input"
            />
          </label>
        </div>
        {error ? (
          <div className="mx-4 mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
            {error}
          </div>
        ) : null}
        {savedAt ? (
          <div className="mx-4 mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">
            ບັນທຶກສຳເລັດ · {new Date(savedAt).toLocaleString()}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-odoo-border px-4 py-3">
          <div className="text-[11px] text-odoo-text-muted">
            {config
              ? `${config.isActive ? "ເປີດໃຊ້" : "ປິດໃຊ້"} · ອັບເດດໂດຍ ${config.updatedBy ?? "—"} · ${new Date(config.updatedAt).toLocaleString()}`
              : "ຍັງບໍ່ມີການຕັ້ງຄ່າ — ໃສ່ຄ່າ ແລະ ກົດບັນທຶກ"}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!canManage || saving}
            className="odoo-btn odoo-btn-primary"
          >
            {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}
