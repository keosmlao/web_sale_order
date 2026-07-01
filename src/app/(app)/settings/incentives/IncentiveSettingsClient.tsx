"use client";

import { useState } from "react";
import IncentiveConfigClient from "./IncentiveConfigClient";
import RewardsEditor from "./RewardsEditor";
import PointMapEditor from "./PointMapEditor";

type TabKey = "config" | "rewards" | "points";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "config", label: "ສູດ & ເປົ້າ", hint: "ໂບນັດ, ເກນຜົນງານ, ຄ່າຄອມ, ເປົ້າ/ຄົນ" },
  { key: "rewards", label: "ເງິນພິເສດ", hint: "ລາງວັນລວມພະແນກ (HISENSE / CE+SDA)" },
  { key: "points", label: "ຄະແນນໂບນັດ", hint: "Point Map ຕໍ່ ໝວດ·ຍີ່ຫໍ້·ດີໄຊ·ຂະໜາດ" },
];

export default function IncentiveSettingsClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<TabKey>("config");
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="odoo-page">
      <div className="odoo-page-header">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">Settings</div>
          <h1 className="odoo-page-title">ຕັ້ງຄ່າ Incentive</h1>
          <p className="odoo-page-subtitle">{active.hint}</p>
        </div>
        {!canManage ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">ອ່ານຢ່າງດຽວ</span>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-odoo-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
              tab === t.key
                ? "border-odoo-primary text-odoo-primary"
                : "border-transparent text-odoo-text-muted hover:text-odoo-text-strong"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Keep each panel mounted so switching tabs doesn't refetch/lose edits. */}
      <div className={tab === "config" ? "" : "hidden"}>
        <IncentiveConfigClient canManage={canManage} embedded />
      </div>
      <div className={tab === "rewards" ? "" : "hidden"}>
        <RewardsEditor canManage={canManage} />
      </div>
      <div className={tab === "points" ? "" : "hidden"}>
        <PointMapEditor canManage={canManage} />
      </div>
    </div>
  );
}
