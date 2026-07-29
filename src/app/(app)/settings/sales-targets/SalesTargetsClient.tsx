"use client";

import { useState } from "react";
import DepartmentTargetCard from "./DepartmentTargetCard";
import EmployeeTargetsTable from "./EmployeeTargetsTable";
import { monthBadge, periodLabel } from "@/lib/incentive-period";

// ຈັດການເປົ້າຂາຍ — the two targets the app cannot compute on its own:
//   1. ເປົ້າລວມພະແນກ  → app_incentive_special_reward (group ALL, no brand),
//      the number the home-page "ລາງວັນພິເສດ" card measures the department
//      against. Set per month; a new month has no row until one is created.
//   2. ເປົ້າລາຍບຸກຄົນ → odg_retail_target_employee, one CE / AC figure per
//      seller. This is also the month's bonus ROSTER: a seller with no target
//      row is not in any reward group and earns nothing.
// Both live behind the existing /api/incentives/* endpoints.

const YEAR_SPAN = 5;

export default function SalesTargetsClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  // Sum of the per-person targets, reported up by the pivot so the department
  // card can show how far the approved total sits from the roster.
  const [rosterTotal, setRosterTotal] = useState(0);

  const years = Array.from({ length: YEAR_SPAN }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">ຈັດການເປົ້າຂາຍ</h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ປ້ອນເປົ້າຂາຍລວມທັງພະແນກ ແລະ ເປົ້າຂາຍລາຍບຸກຄົນ ຂອງແຕ່ລະເດືອນ —
          ໂບນັດ ແລະ ລາງວັນພິເສດ ທັງໝົດຄິດໄລ່ຈາກຕົວເລກໃນໜ້ານີ້.
        </p>
      </header>

      {/* Period picker — every editor below reads this month. */}
      <section
        className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-odoo-border bg-odoo-surface px-4 py-3"
        aria-label="ເລືອກເດືອນ"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">ເດືອນ</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="odoo-input min-w-[140px]"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")} · {periodLabel(year, m).split(" ")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">ປີ</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="odoo-input min-w-[100px]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto rounded-lg bg-teal-50 px-3 py-2 font-mono text-sm font-black text-teal-700">
          {monthBadge(year, month)}
        </span>
      </section>

      <div className="flex flex-col gap-5">
        {/* Remount on period change so each editor reloads from a clean slate
            instead of showing the previous month's values while fetching. */}
        <DepartmentTargetCard
          key={`dept-${year}-${month}`}
          year={year}
          month={month}
          rosterTotal={rosterTotal}
        />
        <EmployeeTargetsTable
          key={`emp-${year}-${month}`}
          year={year}
          month={month}
          onTotalChange={setRosterTotal}
        />
      </div>
    </div>
  );
}
