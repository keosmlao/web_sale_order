"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

type Row = {
  employeeCode: string;
  displayName: string;
  // odg_position: 11 = manager, 12 = unit head. Paid commission on the team's
  // total, so their ຍອດຂາຍ / ເປົ້າ are the department's rather than their own —
  // listing them beside personal figures made the sheet read as if the branch
  // had more sellers than it does.
  position?: string | null;
  groupCode: string;
  soldQty: number;
  salesAmount: number;
  targetPerPerson: number;
  achievementPct: number;
  netBonus: number;
  specialReward: number;
  commission: number;
  totalPay: number;
};

type Report = {
  year: number;
  month: number;
  currencyCode: string;
  rows: Row[];
  totalSales: number;
};

type BreakdownBrand = { brand: string; points: number; salesAmount: number; qty: number };
type BreakdownCategory = {
  category: string;
  label: string;
  points: number;
  salesAmount: number;
  qty: number;
  brands: BreakdownBrand[];
};
type Breakdown = { employeeCode: string; totalPoints: number; categories: BreakdownCategory[] };

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const LAO_MONTHS = [
  "ມັງກອນ", "ກຸມພາ", "ມີນາ", "ເມສາ", "ພຶດສະພາ", "ມິຖຸນາ",
  "ກໍລະກົດ", "ສິງຫາ", "ກັນຍາ", "ຕຸລາ", "ພະຈິກ", "ທັນວາ",
];

function currentPeriod(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Vientiane",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")?.value ?? ""}-${parts.find((p) => p.type === "month")?.value ?? ""}`;
}

export default function PdfReport({ period: initialPeriod }: { period: string }) {
  const period = /^\d{4}-\d{2}$/.test(initialPeriod) ? initialPeriod : currentPeriod();
  const [report, setReport] = useState<Report | null>(null);
  const [details, setDetails] = useState<Record<string, Breakdown>>({});
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const [year, monthRaw] = period.split("-");
    const month = Number(monthRaw);
    try {
      const res = await fetch(`/api/reports/incentives?year=${year}&month=${month}`, { cache: "no-store" });
      const body = (await res.json()) as Report & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setReport(body);

      // Every seller's breakdown has to be on the page before the print dialog
      // opens — the on-screen report loads these lazily on row expand, which
      // would leave the PDF empty.
      const sellers = (body.rows ?? []).filter((r) => r.position !== "11" && r.position !== "12");
      const loaded = await Promise.all(
        sellers.map(async (r) => {
          try {
            const d = await fetch(
              `/api/reports/incentives/breakdown?year=${year}&month=${month}&emp=${encodeURIComponent(r.employeeCode)}`,
              { cache: "no-store" },
            );
            return d.ok ? ((await d.json()) as Breakdown) : null;
          } catch {
            return null;
          }
        }),
      );
      const map: Record<string, Breakdown> = {};
      for (const d of loaded) if (d) map[d.employeeCode] = d;
      setDetails(map);
      setReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  // The browser prints its own header/footer from document.title and offers it
  // as the default filename when saving as PDF.
  useEffect(() => {
    const previous = document.title;
    document.title = `ໂບນັດພະນັກງານຂາຍ ລາຍລະອຽດ ${period}`;
    return () => { document.title = previous; };
  }, [period]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(id);
  }, [ready]);

  if (error) return <div className="pr-state">ໂຫລດບໍ່ສຳເລັດ — {error}</div>;
  if (!report || !ready) return <div className="pr-state">ກຳລັງກະກຽມເອກະສານ…</div>;

  const rows = (report.rows ?? []).filter((r) => r.position !== "11" && r.position !== "12");
  const monthName = LAO_MONTHS[report.month - 1] ?? report.month;
  const cur = report.currencyCode;
  const printedAt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Vientiane", dateStyle: "short", timeStyle: "short",
  }).format(new Date());

  return (
    <div className="pr-sheet">
      <style dangerouslySetInnerHTML={{ __html: "@page { size: A4 landscape; margin: 8mm; }" }} />

      {/* Screen-only: the print dialog's own header/footer (URL, timestamp) can
          only be switched off by the operator, so say where. */}
      <button type="button" className="pr-print-btn" onClick={() => window.print()}>
        ບັນທຶກເປັນ PDF
      </button>
      <div className="pr-hint">
        ເອົາ URL ແລະ ວັນທີຢູ່ຂອບອອກ: ໃນໜ້າຕ່າງພິມ → <b>More settings</b> →
        ຕິກ <b>Headers and footers</b> ອອກ
      </div>

      <header className="pr-head">
        <div className="pr-head-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/odm.png" alt="ODIEN Mall" className="pr-logo" />
          <div>
            <div className="pr-org">ODIEN MALL</div>
            <div className="pr-sub">ສາຂາຂົວຫຼວງ · ຂາຍໜ້າຮ້ານ</div>
          </div>
        </div>
        <div className="pr-head-right">
          <div className="pr-title">ໂບນັດພະນັກງານຂາຍ — ລາຍລະອຽດ</div>
          <div className="pr-period">ເດືອນ {monthName} {report.year}</div>
          <div className="pr-meta">ພິມເມື່ອ {printedAt} · ສະກຸນ {cur}</div>
        </div>
      </header>

      {/* One flat landscape table: a line per (salesperson × ໝວດ × ຍີ່ຫໍ້). The
          person's own figures print once, on their first line, so the sheet
          reads as a single table rather than a stack of little reports. */}
      <table className="pr-table pr-wide">
        <thead>
          <tr>
            <th className="pr-c">#</th>
            <th>ພະນັກງານ</th>
            <th className="pr-c">ກຸ່ມ</th>
            <th className="pr-r">ຍອດຂາຍ</th>
            <th className="pr-r">ເປົ້າ</th>
            <th className="pr-r">ຜົນງານ</th>
            <th className="pr-r">ໂບນັດ</th>
            <th className="pr-r">ລວມລາຍຮັບ</th>
            <th className="pr-sep">ໝວດ</th>
            <th>ຍີ່ຫໍ້</th>
            <th className="pr-r">ຈຳນວນ</th>
            <th className="pr-r">ຍອດຂາຍ</th>
            <th className="pr-r">ຄະແນນ</th>
          </tr>
        </thead>
        {rows.length === 0 ? (
          <tbody><tr><td colSpan={13} className="pr-empty">ບໍ່ມີຂໍ້ມູນໃນເດືອນນີ້</td></tr></tbody>
        ) : rows.map((r, i) => {
          const d = details[r.employeeCode];
          const lines = (d?.categories ?? []).flatMap((cat) =>
            cat.brands.length > 0
              ? cat.brands.map((b) => ({ cat: cat.label || cat.category, ...b }))
              : [{ cat: cat.label || cat.category, brand: "—", qty: cat.qty, salesAmount: cat.salesAmount, points: cat.points }],
          );
          // +1 so the person's cells also cover the subtotal row below; without
          // it the subtotal starts back at column 1 and lands under the person
          // block instead of under the ຈຳນວນ / ຍອດຂາຍ / ຄະແນນ columns.
          const hasSub = lines.length > 0;
          const span = Math.max(1, lines.length) + (hasSub ? 1 : 0);
          const subQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
          const subSales = lines.reduce((s, l) => s + (l.salesAmount || 0), 0);
          const subPoints = lines.reduce((s, l) => s + (l.points || 0), 0);
          return (
            <tbody key={r.employeeCode} className="pr-group">
              {(lines.length > 0 ? lines : [null]).map((ln, j) => (
                <tr key={ln ? `${ln.cat}-${ln.brand}-${j}` : "none"}>
                  {j === 0 ? (
                    <>
                      <td className="pr-c" rowSpan={span}>{i + 1}</td>
                      <td rowSpan={span}>
                        <div className="pr-name">{r.displayName}</div>
                        <div className="pr-code">{r.employeeCode}</div>
                      </td>
                      <td className="pr-c" rowSpan={span}>{r.groupCode}</td>
                      <td className="pr-r" rowSpan={span}>{money.format(r.salesAmount)}</td>
                      <td className="pr-r" rowSpan={span}>{int.format(r.targetPerPerson)}</td>
                      <td className="pr-r" rowSpan={span}>{pct(r.achievementPct)}</td>
                      <td className="pr-r" rowSpan={span}>{money.format(r.netBonus)}</td>
                      <td className="pr-r pr-strong" rowSpan={span}>{money.format(r.totalPay)}</td>
                    </>
                  ) : null}
                  {ln ? (
                    <>
                      <td className="pr-sep">{ln.cat}</td>
                      <td>{ln.brand}</td>
                      <td className="pr-r">{int.format(ln.qty)}</td>
                      <td className="pr-r">{money.format(ln.salesAmount)}</td>
                      <td className="pr-r">{int.format(ln.points)}</td>
                    </>
                  ) : (
                    <td className="pr-sep pr-nodetail" colSpan={5}>ບໍ່ມີສິນຄ້າທີ່ໄດ້ຄະແນນ</td>
                  )}
                </tr>
              ))}
              {hasSub ? (
                <tr className="pr-subtotal">
                  <td className="pr-sep pr-total-label" colSpan={2}>ລວມ</td>
                  <td className="pr-r">{int.format(subQty)}</td>
                  <td className="pr-r">{money.format(subSales)}</td>
                  <td className="pr-r pr-strong">{int.format(subPoints)}</td>
                </tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
