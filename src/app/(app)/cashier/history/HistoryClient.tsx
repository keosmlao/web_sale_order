"use client";

import Link from "next/link";
import { fmtDateTime } from "@/lib/datetime";
import { useCallback, useEffect, useState } from "react";


type Row = {
  docNo: string;
  cartNumber: string | null;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cashierCode: string | null;
  cashierName: string | null;
  saleCode: string | null;
  salespersonName: string | null;
  totalKip: number;
  cashKip: number;
  transferKip: number;
  redeemedKip: number;
  isVoided: boolean;
  voidDocNo: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  source: string | null;
};

const moneyFmt = new Intl.NumberFormat("en-US");

type DailyTender = {
  payMethod: string;
  currencyCode: string;
  amount: number;
  amountKip: number;
  bills: number;
};

type DailySummary = {
  bills: number;
  tenders: DailyTender[];
  totalKip: number;
  cashKip: number;
  transferKip: number;
  redeemedKip: number;
  changeKip: number;
  remitKip: number;
  sml: {
    bills: number;
    cashKip: number;
    transferKip: number;
    totalKip: number;
  };
};

const CURRENCY_NAMES: Record<string, string> = {
  "02": "ກີບ (LAK)",
  "01": "ບາດ (THB)",
};

function currencyName(code: string): string {
  return CURRENCY_NAMES[code] ?? code;
}

// Local YYYY-MM-DD, for <input type="date"> values and the quick ranges.
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// The ranges a cashier actually asks for, one tap each. Everything else is
// behind ຕົວກອງ.
function quickRanges(): Array<{ label: string; from: string; to: string }> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const week = new Date(today);
  week.setDate(today.getDate() - 6);
  return [
    { label: "ມື້ນີ້", from: ymd(today), to: ymd(today) },
    { label: "ວານນີ້", from: ymd(yesterday), to: ymd(yesterday) },
    { label: "7 ວັນ", from: ymd(week), to: ymd(today) },
    { label: "ທັງໝົດ", from: "", to: "" },
  ];
}

// Badge for the channel that created the order: 'web' (browser POS) or 'app'
// (Flutter sales app). Older orders have no record → show a neutral dash.
function SourceBadge({ source }: { source: string | null }) {
  if (source === "web") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
        🖥 Web
      </span>
    );
  }
  if (source === "app") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
        📱 App
      </span>
    );
  }
  // A receipt raised inside SML rather than at this till.
  if (source === "sml") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
        SML
      </span>
    );
  }
  return <span className="text-[11px] text-odoo-text-muted">—</span>;
}

export default function HistoryClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // The list opens on today — that is the day a cashier is working; the
  // quick chips and the pickers reach anything older.
  const [from, setFrom] = useState(() => ymd(new Date()));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [status, setStatus] = useState<"all" | "settled" | "voided">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState<"list" | "summary">("list");
  const [sumDate, setSumDate] = useState(() => ymd(new Date()));
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/cashier/history?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [q, from, to, status]);

  const [deleting, setDeleting] = useState<string | null>(null);

  // Take the receipt off and put the order back to waiting for payment.
  // The server does the unwinding and checks the role; this only makes
  // sure nobody does it by accident — the figure is in the question so
  // there is something to recognise before saying yes.
  async function deleteReceipt(r: Row) {
    if (deleting || !r.cartNumber) return;
    const ok = window.confirm(
      `ລົບໃບຮັບເງິນ ${r.docNo} (${moneyFmt.format(r.totalKip)} ກີບ)?\n` +
        `ອໍເດີ #${r.cartNumber} ຈະກັບໄປສະຖານະລໍຖ້າຮັບເງິນ, ` +
        `stock ຄືນ ແລະ ແຕ້ມທີ່ໃຊ້ຈະຖືກຄືນໃຫ້ລູກຄ້າ.`,
    );
    if (!ok) return;
    setDeleting(r.docNo);
    try {
      const res = await fetch(
        `/api/cashier/orders/${encodeURIComponent(r.cartNumber)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        window.alert(data?.error ?? `ຂໍ້ຜິດພາດ ${res.status}`);
        return;
      }
      await fetchHistory();
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void fetchHistory();
    });
  }, [fetchHistory]);

  // The day-close tab: one fetch per chosen date.
  useEffect(() => {
    if (tab !== "summary") return;
    let cancelled = false;
    setSummaryLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/cashier/daily-summary?date=${encodeURIComponent(sumDate)}`,
        );
        const data = res.ok ? await res.json() : null;
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, sumDate]);

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          Cashier
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ປະຫວັດການຂາຍ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ຄົ້ນບິນທີ່ຮັບເງິນແລ້ວ ໂດຍເລກບິນ, ຊື່ລູກຄ້າ, ເບີໂທ ຫຼື ໄລຍະວັນທີ.
        </p>
      </header>

      <div className="mb-4 flex gap-1 rounded-lg bg-odoo-surface-muted p-1 sm:w-fit">
        {(
          [
            ["list", "ໃບຮັບເງິນ"],
            ["summary", "ສະຫລຸບຮັບເງິນປະຈຳວັນ"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={
              "flex-1 rounded-md px-4 py-2 text-sm font-bold transition sm:flex-none " +
              (tab === value
                ? "bg-white text-odoo-primary shadow-sm"
                : "text-odoo-text-muted hover:text-odoo-text")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <DailySummaryView
          date={sumDate}
          onDateChange={setSumDate}
          summary={summary}
          loading={summaryLoading}
        />
      ) : (
        <>
      {/* The filter block used to be four stacked fields — a full phone
          screen of empty form before the first receipt. What a cashier
          actually does here is search a number or tap a day. So: one
          search bar, one row of ready-made ranges, and the seldom-used
          date pickers and status behind ຕົວກອງ. */}
      <div className="mb-4 rounded-md border border-odoo-border bg-odoo-surface p-3">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ຄົ້ນ ເລກບິນ / ຊື່ / ເບີໂທ"
            className="odoo-input flex-1"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`odoo-btn shrink-0 ${
              from || to || status !== "all"
                ? "border-odoo-primary text-odoo-primary"
                : ""
            }`}
          >
            ຕົວກອງ {filtersOpen ? "▴" : "▾"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickRanges().map((r) => {
            const active = from === r.from && to === r.to;
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => {
                  setFrom(r.from);
                  setTo(r.to);
                }}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition " +
                  (active
                    ? "bg-odoo-primary text-white"
                    : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
        {filtersOpen ? (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-odoo-border pt-3 sm:grid-cols-3">
            <label className="grid gap-1">
              <span className="odoo-label">ຈາກວັນທີ</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="odoo-input"
              />
            </label>
            <label className="grid gap-1">
              <span className="odoo-label">ເຖິງວັນທີ</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="odoo-input"
              />
            </label>
            <div className="col-span-2 grid gap-1 sm:col-span-1">
              <span className="odoo-label">ສະຖານະ</span>
              <div className="flex gap-1.5">
                {(
                  [
                    ["all", "ທັງໝົດ"],
                    ["settled", "ປົກກະຕິ"],
                    ["voided", "ຍົກເລີກ"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatus(value)}
                    className={
                      "flex-1 rounded-md px-2 py-2 text-xs font-semibold transition " +
                      (status === value
                        ? "bg-odoo-primary text-white"
                        : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
          {error}
        </div>
      ) : null}

      {/* On a phone the table clipped after the customer column, hiding the
          figures and the actions off the right edge. Below sm each receipt
          is a bill-shaped card: number and status on top, the total large,
          cash/transfer split underneath, delete under the thumb. */}
      <div className="sm:hidden">
        {loading ? (
          <p className="px-3 py-6 text-center text-sm text-odoo-text-muted">
            ກຳລັງໂຫລດ…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-odoo-text-muted">
            ບໍ່ພົບຂໍ້ມູນ
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <li
                key={r.docNo}
                className={`rounded-xl border p-3 ${
                  r.isVoided
                    ? "border-rose-200 bg-rose-50/40 opacity-80"
                    : "border-odoo-border bg-odoo-surface"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/cashier/receipts/${r.docNo}`}
                    className="font-mono text-[13px] font-bold text-odoo-link"
                  >
                    {r.docNo}
                  </Link>
                  <span className="flex items-center gap-1.5">
                    <SourceBadge source={r.source} />
                    {r.isVoided ? (
                      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-odoo-danger">
                        ຍົກເລີກ
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        ປົກກະຕິ
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-odoo-text-strong">
                      {r.customerName ?? "—"}
                    </div>
                    {r.customerPhone ? (
                      <div className="text-[11px] text-odoo-text-muted">
                        {r.customerPhone}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 font-mono text-base font-bold">
                    {moneyFmt.format(r.totalKip)}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-odoo-text-muted">
                  <span>{fmtDateTime(r.createdAt)}</span>
                  {r.salespersonName || r.saleCode ? (
                    <>
                      <span>·</span>
                      <span>ຂາຍ {r.salespersonName ?? r.saleCode}</span>
                    </>
                  ) : null}
                  <span>·</span>
                  <span>{r.cashierName ?? r.cashierCode ?? "—"}</span>
                  {r.cashKip > 0 ? (
                    <>
                      <span>·</span>
                      <span>ສົດ {moneyFmt.format(r.cashKip)}</span>
                    </>
                  ) : null}
                  {r.transferKip > 0 ? (
                    <>
                      <span>·</span>
                      <span>ໂອນ {moneyFmt.format(r.transferKip)}</span>
                    </>
                  ) : null}
                </div>
                {r.isVoided ? (
                  r.voidDocNo ? (
                    <div className="mt-1 text-[11px] text-odoo-text-muted">
                      {r.voidDocNo}
                      {r.voidReason ? ` · ${r.voidReason}` : ""}
                    </div>
                  ) : null
                ) : null}
                <div className="mt-2.5 flex gap-2">
                  <Link
                    href={`/cashier/receipts/${encodeURIComponent(r.docNo)}?view=pay`}
                    className="odoo-btn odoo-btn-secondary h-10 flex-1 justify-center"
                  >
                    ລາຍລະອຽດ
                  </Link>
                  <Link
                    href={`/cashier/receipts/${encodeURIComponent(r.docNo)}?print=1`}
                    className="odoo-btn odoo-btn-secondary h-10 flex-1 justify-center"
                  >
                    ພິມ
                  </Link>
                  {!r.isVoided && r.cartNumber ? (
                    <button
                      type="button"
                      disabled={deleting === r.docNo}
                      onClick={() => void deleteReceipt(r)}
                      className="odoo-btn odoo-btn-danger h-10"
                    >
                      {deleting === r.docNo ? "ລົບ…" : "ລົບ"}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface sm:block">
        <table className="w-full text-sm">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">ເລກບິນ</th>
              <th className="px-3 py-2">ວັນທີ</th>
              <th className="px-3 py-2">ລູກຄ້າ</th>
              <th className="px-3 py-2">ພະນັກງານຂາຍ</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2">ຊ່ອງທາງ</th>
              <th className="px-3 py-2 text-right">ຍອດ (ກີບ)</th>
              <th className="px-3 py-2 text-right">ເງິນສົດ</th>
              <th className="px-3 py-2 text-right">ໂອນ</th>
              <th className="px-3 py-2">ສະຖານະ</th>
              <th className="px-3 py-2 text-right">ຈັດການ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-odoo-text-muted"
                >
                  ກຳລັງໂຫລດ…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-odoo-text-muted"
                >
                  ບໍ່ພົບຂໍ້ມູນ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.docNo}
                  className="border-t border-odoo-border hover:bg-odoo-surface-muted/50"
                >
                  <td className="px-3 py-2 font-mono text-[12px]">
                    <Link
                      href={`/cashier/receipts/${r.docNo}`}
                      className="text-odoo-link hover:underline"
                    >
                      {r.docNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-odoo-text-muted">
                    {fmtDateTime(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-odoo-text-strong">
                      {r.customerName ?? "—"}
                    </div>
                    {r.customerPhone ? (
                      <div className="text-[11px] text-odoo-text-muted">
                        {r.customerPhone}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.salespersonName ?? r.saleCode ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.cashierName ?? r.cashierCode ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <SourceBadge source={r.source} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {moneyFmt.format(r.totalKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    {moneyFmt.format(r.cashKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    {moneyFmt.format(r.transferKip)}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.isVoided ? (
                      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 font-bold text-odoo-danger">
                        ຍົກເລີກ
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
                        ປົກກະຕິ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {/* Seeing how the money arrived and printing the bill
                        are different errands — one button each. ພິມ opens
                        the receipt with the print dialog already up. */}
                    <span className="inline-flex items-center gap-1">
                      <Link
                        href={`/cashier/receipts/${encodeURIComponent(r.docNo)}?view=pay`}
                        className="odoo-btn odoo-btn-secondary !px-2 !py-1 !text-[11px]"
                      >
                        ລາຍລະອຽດ
                      </Link>
                      <Link
                        href={`/cashier/receipts/${encodeURIComponent(r.docNo)}?print=1`}
                        className="odoo-btn odoo-btn-secondary !px-2 !py-1 !text-[11px]"
                      >
                        ພິມ
                      </Link>
                    </span>{" "}
                    {/* Delete, not void. Voiding writes a reversal document
                        and leaves both halves on the books; deleting takes
                        the receipt off and puts the order back to waiting
                        for payment, which is what a receipt raised by
                        mistake needs. The API unwinds the cash ledger, the
                        stock movement and any points spent, and it already
                        requires a manager for a settled bill — the same bar
                        as voiding, because it is the same outcome. */}
                    {r.isVoided ? (
                      <span
                        className="text-[11px] text-odoo-text-muted"
                        title={r.voidReason ?? undefined}
                      >
                        {r.voidDocNo ?? "—"}
                      </span>
                    ) : r.cartNumber ? (
                      <button
                        type="button"
                        disabled={deleting === r.docNo}
                        onClick={() => void deleteReceipt(r)}
                        className="odoo-btn odoo-btn-danger !px-2 !py-1 !text-[11px]"
                      >
                        {deleting === r.docNo ? "ກຳລັງລົບ…" : "ລົບໃບຮັບ"}
                      </button>
                    ) : (
                      <span className="text-[11px] text-odoo-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  );
}

function DailySummaryView({
  date,
  onDateChange,
  summary,
  loading,
}: {
  date: string;
  onDateChange: (v: string) => void;
  summary: DailySummary | null;
  loading: boolean;
}) {
  const cash = (summary?.tenders ?? []).filter((t) => t.payMethod === "cash");
  const transfer = (summary?.tenders ?? []).filter(
    (t) => t.payMethod === "transfer",
  );
  const other = (summary?.tenders ?? []).filter(
    (t) => t.payMethod !== "cash" && t.payMethod !== "transfer",
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-odoo-border bg-odoo-surface p-3">
        <span className="odoo-label">ວັນທີ</span>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="odoo-input w-auto"
        />
        {summary ? (
          <span className="ml-auto text-sm font-semibold text-odoo-text-muted">
            {moneyFmt.format(summary.bills)} ບິນ
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="px-3 py-8 text-center text-sm text-odoo-text-muted">
          ກຳລັງໂຫລດ…
        </p>
      ) : !summary ? (
        <p className="px-3 py-8 text-center text-sm text-odoo-text-muted">
          ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-odoo-border bg-odoo-surface p-4">
              <h2 className="text-sm font-black text-odoo-text-strong">
                ເງິນສົດ — ແຍກສະກຸນ
              </h2>
              {cash.length === 0 ? (
                <p className="mt-3 text-sm text-odoo-text-muted">ບໍ່ມີ</p>
              ) : (
                <ul className="mt-2 divide-y divide-odoo-border">
                  {cash.map((t) => (
                    <li
                      key={t.currencyCode}
                      className="flex items-baseline justify-between py-2"
                    >
                      <span className="text-sm font-semibold">
                        {currencyName(t.currencyCode)}
                      </span>
                      <span className="text-right">
                        <b className="font-mono text-[15px]">
                          {moneyFmt.format(t.amount)}
                        </b>
                        {t.currencyCode !== "02" ? (
                          <small className="block text-[11px] text-odoo-text-muted">
                            ≈ {moneyFmt.format(t.amountKip)} ກີບ
                          </small>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {summary.sml.cashKip > 0 ? (
                <div className="mt-2 flex items-baseline justify-between border-t border-odoo-border pt-2 text-sm">
                  <span className="text-odoo-text-muted">
                    ບິນ SML (ທຽບກີບ)
                  </span>
                  <span className="font-mono font-bold">
                    {moneyFmt.format(summary.sml.cashKip)}
                  </span>
                </div>
              ) : null}
              {summary.changeKip > 0 ? (
                <div className="mt-2 flex items-baseline justify-between border-t border-odoo-border pt-2 text-sm">
                  <span className="text-odoo-text-muted">ເງິນທອນ (ກີບ)</span>
                  <span className="font-mono font-bold text-odoo-danger">
                    −{moneyFmt.format(summary.changeKip)}
                  </span>
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-odoo-border bg-odoo-surface p-4">
              <h2 className="text-sm font-black text-odoo-text-strong">
                ເງິນໂອນ — ແຍກສະກຸນ
              </h2>
              {transfer.length === 0 ? (
                <p className="mt-3 text-sm text-odoo-text-muted">ບໍ່ມີ</p>
              ) : (
                <ul className="mt-2 divide-y divide-odoo-border">
                  {transfer.map((t) => (
                    <li
                      key={t.currencyCode}
                      className="flex items-baseline justify-between py-2"
                    >
                      <span className="text-sm font-semibold">
                        {currencyName(t.currencyCode)}
                      </span>
                      <span className="text-right">
                        <b className="font-mono text-[15px]">
                          {moneyFmt.format(t.amount)}
                        </b>
                        {t.currencyCode !== "02" ? (
                          <small className="block text-[11px] text-odoo-text-muted">
                            ≈ {moneyFmt.format(t.amountKip)} ກີບ
                          </small>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {summary.sml.transferKip > 0 ? (
                <div className="mt-2 flex items-baseline justify-between border-t border-odoo-border pt-2 text-sm">
                  <span className="text-odoo-text-muted">
                    ບິນ SML (ທຽບກີບ)
                  </span>
                  <span className="font-mono font-bold">
                    {moneyFmt.format(summary.sml.transferKip)}
                  </span>
                </div>
              ) : null}
              {other.length > 0 ? (
                <div className="mt-2 border-t border-odoo-border pt-2">
                  {other.map((t) => (
                    <div
                      key={`${t.payMethod}-${t.currencyCode}`}
                      className="flex items-baseline justify-between py-1 text-sm"
                    >
                      <span className="text-odoo-text-muted">
                        {t.payMethod} · {currencyName(t.currencyCode)}
                      </span>
                      <span className="font-mono font-semibold">
                        {moneyFmt.format(t.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          {/* The figure the drawer is counted against at day close. */}
          <section className="rounded-xl border border-odoo-primary/40 bg-odoo-primary/5 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-black text-odoo-text-strong">
                ລວມເງິນທີ່ຕ້ອງສົ່ງ (ສົດ)
              </h2>
              <b className="font-mono text-2xl font-black text-odoo-primary">
                {moneyFmt.format(summary.remitKip)} ກີບ
              </b>
            </div>
            <div className="mt-2 grid gap-1 border-t border-odoo-primary/20 pt-2 text-sm sm:grid-cols-3">
              <div className="flex items-baseline justify-between sm:block">
                <span className="text-odoo-text-muted">ໂອນເຂົ້າບັນຊີ</span>
                <b className="font-mono sm:block">
                  {moneyFmt.format(summary.transferKip + summary.sml.transferKip)} ກີບ
                </b>
              </div>
              <div className="flex items-baseline justify-between sm:block">
                <span className="text-odoo-text-muted">ສ່ວນຫຼຸດແຕ້ມ</span>
                <b className="font-mono sm:block">
                  {moneyFmt.format(summary.redeemedKip)} ກີບ
                </b>
              </div>
              <div className="flex items-baseline justify-between sm:block">
                <span className="text-odoo-text-muted">ລວມຮັບທັງໝົດ</span>
                <b className="font-mono sm:block">
                  {moneyFmt.format(summary.totalKip + summary.sml.totalKip)} ກີບ
                </b>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-odoo-text-muted">
              ຮວມທຸກບິນຂອງຮ້ານ — POS ແຍກສະກຸນ · ບິນ SML ({moneyFmt.format(summary.sml.bills)} ບິນ) ທຽບເປັນກີບຈາກ cb_trans
            </p>
          </section>
        </>
      )}
    </div>
  );
}
