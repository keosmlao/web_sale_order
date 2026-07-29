"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BrandSelect from "@/components/BrandSelect";
import {
  digitsOf,
  fmt,
  formatAmountInput,
  monthBadge,
  monthEnd,
  monthStart,
  periodLabel,
} from "@/lib/incentive-period";

// ຈັດການລາງວັນພິເສດ — full CRUD over app_incentive_special_reward, the table
// behind the home-page "ລາງວັນພິເສດ" card and column ② of the incentives
// report. One row = one announced program: reach target_amount and reward_amount
// is paid, either flat per person or split by each person's share of the sales.
//
// group_code decides WHOSE sales count (see /api/reports/special-rewards):
//   ALL     — the whole department's scoped sales
//   AIR     — members holding an AC target that month
//   CE_SDA  — members holding a CE target that month
// brand_code narrows a program to one brand (e.g. HISENSE); empty = all brands.
//
// Writes go through /api/incentives/rewards, which is head / manager only.

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

// A row as edited on screen: amounts are comma-grouped text, and `saved` keeps
// the server's values so ບັນທຶກ only lights up for rows that actually changed.
type Row = {
  code: string;
  description: string;
  groupCode: string;
  brandCode: string | null;
  splitByShare: boolean;
  target: string;
  reward: string;
  isActive: boolean;
  from: string;
  to: string;
  saved: { target: number; reward: number; isActive: boolean; from: string; to: string };
};

const GROUPS = [
  { code: "ALL", label: "ALL · ລວມທັງພະແນກ" },
  { code: "AIR", label: "AIR · ແອ" },
  { code: "CE_SDA", label: "CE_SDA · ເຄື່ອງໃຊ້ໄຟຟ້າ + ປະປາ" },
] as const;

const groupLabel = (code: string) => GROUPS.find((g) => g.code === code)?.label ?? code;

const toRow = (r: Reward): Row => ({
  code: r.rewardCode,
  description: r.description,
  groupCode: r.groupCode,
  brandCode: r.brandCode,
  splitByShare: r.splitByShare,
  target: formatAmountInput(String(r.targetAmount)),
  reward: formatAmountInput(String(r.rewardAmount)),
  isActive: r.isActive,
  from: r.effectiveFrom,
  to: r.effectiveTo,
  saved: {
    target: r.targetAmount,
    reward: r.rewardAmount,
    isActive: r.isActive,
    from: r.effectiveFrom,
    to: r.effectiveTo,
  },
});

const isDirty = (row: Row) =>
  digitsOf(row.target) !== row.saved.target ||
  digitsOf(row.reward) !== row.saved.reward ||
  row.isActive !== row.saved.isActive ||
  row.from !== row.saved.from ||
  row.to !== row.saved.to;

const emptyDraft = (year: number, month: number) => ({
  description: "",
  groupCode: "ALL",
  brandCode: "",
  target: "",
  reward: "",
  splitByShare: false,
  isActive: true,
  from: monthStart(year, month),
  to: monthEnd(year, month),
});

const YEAR_SPAN = 5;

export default function SpecialRewardsClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  // The list defaults to every program so past months stay visible; the picker
  // above still supplies the date range a new program is created with.
  const [scopeMonth, setScopeMonth] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [brands, setBrands] = useState<{ air: string[]; other: string[] }>({ air: [], other: [] });
  const [draft, setDraft] = useState(() => emptyDraft(now.getFullYear(), now.getMonth() + 1));
  const [showDraft, setShowDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Omitting year/month makes the API return every program (its WHERE
      // short-circuits on year = 0), which is what the unscoped list wants.
      const query = scopeMonth ? `?year=${year}&month=${month}` : "";
      const res = await fetch(`/api/incentives/rewards${query}`, { cache: "no-store" });
      const data = (await res.json()) as { rewards?: Reward[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setRows((data.rewards ?? []).map(toRow));
    } catch (err) {
      setRows([]);
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "ໂຫລດລາງວັນພິເສດບໍ່ສຳເລັດ",
      });
    } finally {
      setLoading(false);
    }
  }, [year, month, scopeMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/incentives/brands", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { air: [], other: [] }))
      .then((body: { air?: string[]; other?: string[] }) =>
        setBrands({ air: body.air ?? [], other: body.other ?? [] }),
      )
      .catch(() => setBrands({ air: [], other: [] }));
  }, []);

  // Opening the form seeds it from the month picked right now; closing it
  // discards whatever was typed. Doing this on the click rather than in an
  // effect keeps the picked month from clobbering dates mid-edit.
  function toggleDraft() {
    if (showDraft) {
      setShowDraft(false);
      return;
    }
    setDraft(emptyDraft(year, month));
    setShowDraft(true);
  }

  const patch = (code: string, changes: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.code === code ? { ...r, ...changes } : r)));

  async function saveRow(row: Row) {
    setBusy(row.code);
    setNotice(null);
    try {
      const res = await fetch("/api/incentives/rewards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardCode: row.code,
          isActive: row.isActive,
          targetAmount: digitsOf(row.target),
          rewardAmount: digitsOf(row.reward),
          effectiveFrom: row.from,
          effectiveTo: row.to,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      await load();
      setNotice({ ok: true, text: `ບັນທຶກ ${row.code} ແລ້ວ` });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ" });
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!draft.description.trim()) {
      setNotice({ ok: false, text: "ຕ້ອງໃສ່ຄຳອະທິບາຍ" });
      return;
    }
    if (digitsOf(draft.target) <= 0) {
      setNotice({ ok: false, text: "ເປົ້າຕ້ອງໃຫຍ່ກວ່າ 0" });
      return;
    }
    if (draft.to < draft.from) {
      setNotice({ ok: false, text: "ວັນທີສິ້ນສຸດຕ້ອງບໍ່ກ່ອນວັນທີເລີ່ມ" });
      return;
    }
    setBusy("__new__");
    setNotice(null);
    try {
      const res = await fetch("/api/incentives/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: draft.description.trim(),
          groupCode: draft.groupCode,
          brandCode: draft.brandCode.trim(),
          targetAmount: digitsOf(draft.target),
          rewardAmount: digitsOf(draft.reward),
          splitByShare: draft.splitByShare,
          isActive: draft.isActive,
          effectiveFrom: draft.from,
          effectiveTo: draft.to,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      await load();
      setDraft(emptyDraft(year, month));
      setShowDraft(false);
      setNotice({ ok: true, text: "ເພີ່ມລາງວັນໃໝ່ແລ້ວ" });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "ເພີ່ມບໍ່ສຳເລັດ" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: Row) {
    // Deleting drops the program from every past report that reads this table,
    // so spell out exactly which row is going.
    const ok = window.confirm(
      `ລຶບລາງວັນນີ້ອອກຖາວອນ?\n\n${row.code}\n${row.description}\n` +
        `${groupLabel(row.groupCode)}${row.brandCode ? ` · ${row.brandCode}` : ""}\n` +
        `ເປົ້າ ${fmt.format(digitsOf(row.target))} · ລາງວັນ ${fmt.format(digitsOf(row.reward))}\n` +
        `${row.from} → ${row.to}`,
    );
    if (!ok) return;
    setBusy(row.code);
    setNotice(null);
    try {
      const res = await fetch(`/api/incentives/rewards?code=${encodeURIComponent(row.code)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      await load();
      setNotice({ ok: true, text: `ລຶບ ${row.code} ແລ້ວ` });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "ລຶບບໍ່ສຳເລັດ" });
    } finally {
      setBusy(null);
    }
  }

  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows]);
  const years = Array.from({ length: YEAR_SPAN }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">ຈັດການລາງວັນພິເສດ</h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ເພີ່ມ · ແກ້ · ລຶບ ໂຄງການລາງວັນໃນຕາຕະລາງ <code>app_incentive_special_reward</code> —
          ຕົວທີ່ card “ລາງວັນພິເສດ” ໜ້າຫຼັກ ແລະ ລາຍງານໂບນັດ ນຳໄປໃຊ້.
        </p>
      </header>

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
        <label className="flex items-center gap-2 pb-2 text-xs font-bold text-odoo-text-strong">
          <input
            type="checkbox"
            checked={scopeMonth}
            onChange={(e) => setScopeMonth(e.target.checked)}
            className="h-4 w-4 accent-odoo-primary"
          />
          ສະແດງສະເພາະເດືອນນີ້
        </label>
        <span className="ml-auto rounded-lg bg-teal-50 px-3 py-2 font-mono text-sm font-black text-teal-700">
          {monthBadge(year, month)}
        </span>
      </section>

      {notice ? (
        <div
          className={
            "mb-4 rounded-md border px-3 py-2 text-[13px] font-semibold " +
            (notice.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-rose-300 bg-rose-50 text-odoo-danger")
          }
        >
          {notice.text}
        </div>
      ) : null}

      <section className="rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-odoo-border px-4 py-3">
          <div className="text-sm font-bold text-odoo-text-strong">
            {rows.length} ໂຄງການ · ເປີດໃຊ້ {activeCount}
            <span className="ml-2 text-xs font-normal text-odoo-text-muted">
              {scopeMonth ? `ສະເພາະ ${periodLabel(year, month)}` : "ທຸກເດືອນ"}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void load()} className="odoo-btn">
              ໂຫລດໃໝ່
            </button>
            <button
              type="button"
              onClick={toggleDraft}
              className="odoo-btn odoo-btn-primary"
            >
              {showDraft ? "ຍົກເລີກ" : "+ ເພີ່ມລາງວັນໃໝ່"}
            </button>
          </div>
        </div>

        {showDraft ? (
          <div className="border-b border-odoo-border bg-odoo-surface-muted px-4 py-4">
            <div className="mb-3 text-xs font-black uppercase tracking-wide text-odoo-text-strong">
              ເພີ່ມໂຄງການລາງວັນໃໝ່
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
                <Lbl>ຄຳອະທິບາຍ</Lbl>
                <input
                  type="text"
                  value={draft.description}
                  placeholder="ຕ.ຢ. ບັນລຸເປົ້າຍອດຂາຍລວມທັງພະແນກ ສິງຫາ 2026"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="odoo-input"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Lbl>ຂອບເຂດ (group)</Lbl>
                <select
                  value={draft.groupCode}
                  onChange={(e) => setDraft({ ...draft, groupCode: e.target.value })}
                  className="odoo-input"
                >
                  {GROUPS.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col gap-1">
                <Lbl>ແບຮນດ໌ (ວ່າງ = ທຸກແບຮນດ໌)</Lbl>
                <BrandSelect
                  value={draft.brandCode}
                  placeholder="ທຸກແບຮນດ໌"
                  options={draft.groupCode === "AIR" ? brands.air : brands.other}
                  onChange={(v) => setDraft({ ...draft, brandCode: v })}
                  wrapClassName="w-full"
                />
              </div>
              <label className="flex flex-col gap-1">
                <Lbl>ເປົ້າ (ບາດ)</Lbl>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.target}
                  placeholder="0"
                  onChange={(e) => setDraft({ ...draft, target: formatAmountInput(e.target.value) })}
                  className="odoo-input text-right font-mono font-black"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Lbl>ລາງວັນ (ບາດ)</Lbl>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.reward}
                  placeholder="0"
                  onChange={(e) => setDraft({ ...draft, reward: formatAmountInput(e.target.value) })}
                  className="odoo-input text-right font-mono font-black"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Lbl>ເລີ່ມ</Lbl>
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                  className="odoo-input"
                />
              </label>
              <label className="flex flex-col gap-1">
                <Lbl>ຮອດ</Lbl>
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                  className="odoo-input"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-odoo-text-strong">
                <input
                  type="checkbox"
                  checked={draft.splitByShare}
                  onChange={(e) => setDraft({ ...draft, splitByShare: e.target.checked })}
                  className="h-4 w-4 accent-odoo-primary"
                />
                ແບ່ງລາງວັນຕາມສັດສ່ວນຍອດຂາຍ (ບໍ່ຕິກ = ຈ່າຍເທົ່າກັນ ຕໍ່ຄົນ)
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-odoo-text-strong">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  className="h-4 w-4 accent-odoo-primary"
                />
                ເປີດໃຊ້ (ຈ່າຍຈິງ)
              </label>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy === "__new__"}
                className="odoo-btn odoo-btn-primary disabled:opacity-40"
              >
                {busy === "__new__" ? "ກຳລັງເພີ່ມ…" : "ເພີ່ມ"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-odoo-surface-muted text-left text-[10px] font-bold uppercase tracking-wider text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3">ລາງວັນ</th>
                <th className="px-4 py-3">ຂອບເຂດ</th>
                <th className="px-4 py-3">ໄລຍະນຳໃຊ້</th>
                <th className="px-4 py-3 text-right">ເປົ້າ (ບາດ)</th>
                <th className="px-4 py-3 text-right">ລາງວັນ (ບາດ)</th>
                <th className="px-4 py-3 text-center">ເປີດໃຊ້</th>
                <th className="px-4 py-3 text-right">ຈັດການ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-odoo-text-muted">
                    ກຳລັງໂຫລດ…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-odoo-text-muted">
                    ບໍ່ມີໂຄງການລາງວັນ — ກົດ “+ ເພີ່ມລາງວັນໃໝ່” ເພື່ອສ້າງ
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const dirty = isDirty(row);
                  const isDeptTarget = row.groupCode === "ALL" && !row.brandCode;
                  return (
                    <tr key={row.code} className="border-t border-odoo-border align-top">
                      <td className="px-4 py-3">
                        <div className="font-bold text-odoo-text-strong">{row.description}</div>
                        <div className="font-mono text-[10px] text-odoo-text-muted">{row.code}</div>
                        {isDeptTarget ? (
                          <div className="mt-1 inline-block rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                            ເປົ້າລວມພະແນກ · ແກ້ໄດ້ໃນໜ້າ ຈັດການເປົ້າຂາຍ ນຳ
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-bold text-odoo-text-strong">
                          {row.groupCode}
                          {row.brandCode ? ` · ${row.brandCode}` : ""}
                        </div>
                        <div className="text-odoo-text-muted">
                          {row.splitByShare ? "ແບ່ງຕາມ % ຍອດຂາຍ" : "ຈ່າຍເທົ່າກັນ/ຄົນ"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="grid gap-1">
                          <input
                            type="date"
                            value={row.from}
                            onChange={(e) => patch(row.code, { from: e.target.value })}
                            className="odoo-input w-36 text-xs"
                          />
                          <input
                            type="date"
                            value={row.to}
                            onChange={(e) => patch(row.code, { to: e.target.value })}
                            className="odoo-input w-36 text-xs"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={row.target}
                          onChange={(e) =>
                            patch(row.code, { target: formatAmountInput(e.target.value) })
                          }
                          className="odoo-input w-32 text-right font-mono"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={row.reward}
                          onChange={(e) =>
                            patch(row.code, { reward: formatAmountInput(e.target.value) })
                          }
                          className="odoo-input w-28 text-right font-mono"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={row.isActive}
                          onChange={(e) => patch(row.code, { isActive: e.target.checked })}
                          className="h-4 w-4 accent-odoo-primary"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={busy === row.code || !dirty}
                            onClick={() => void saveRow(row)}
                            className="odoo-btn odoo-btn-primary disabled:opacity-40"
                          >
                            {busy === row.code ? "…" : "ບັນທຶກ"}
                          </button>
                          <button
                            type="button"
                            disabled={busy === row.code}
                            onClick={() => void remove(row)}
                            className="odoo-btn text-rose-600 disabled:opacity-40"
                          >
                            ລຶບ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-odoo-border px-4 py-3 text-xs text-odoo-text-muted">
          ຄຳອະທິບາຍ, group, ແບຮນດ໌ ແລະ ກົດການແບ່ງລາງວັນ ກຳນົດຕອນສ້າງເທົ່ານັ້ນ —
          ຖ້າຕ້ອງປ່ຽນ ໃຫ້ລຶບແລ້ວສ້າງໃໝ່. ໄລຍະນຳໃຊ້ຜູກລາງວັນໄວ້ກັບເດືອນນັ້ນ
          ເພື່ອບໍ່ໃຫ້ກົດເດືອນໃໝ່ ໄປປ່ຽນລາຍງານເດືອນເກົ່າ.
        </div>
      </section>
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide text-odoo-text-muted">
      {children}
    </span>
  );
}
