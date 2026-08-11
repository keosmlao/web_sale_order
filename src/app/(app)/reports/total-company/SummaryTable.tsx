import type { RowTone, SummaryRow } from "@/lib/company-summary";
import { fmt } from "@/lib/incentive-period";

const TONE: Record<RowTone, { row: string; dot: string; badge: string; name: string }> = {
  actual: { row: "border-l-odoo-success bg-odoo-success-bg/45", dot: "bg-odoo-success", badge: "bg-odoo-success-bg text-odoo-success-text", name: "ຍອດຈິງ" },
  estimate: { row: "border-l-odien-yellow bg-odoo-warning-bg/45", dot: "bg-odien-yellow", badge: "bg-odoo-warning-bg text-odoo-warning-text", name: "ຄາດຄະເນ" },
  forecast: { row: "border-l-odien-orange bg-orange-50/55", dot: "bg-odien-orange", badge: "bg-orange-50 text-orange-800", name: "ພະຍາກອນ" },
  annual: { row: "border-l-odoo-primary bg-odoo-primary-50/55", dot: "bg-odoo-primary", badge: "bg-odoo-primary-100 text-odoo-primary-dark", name: "ລາຍປີ" },
  quarter: { row: "border-l-odoo-primary-light bg-sky-50/45", dot: "bg-odoo-primary-light", badge: "bg-sky-100 text-sky-800", name: "ໄຕມາດ" },
  average: { row: "border-l-slate-300 bg-white", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600", name: "ສະເລ່ຍ" },
};

const LABELS: Record<string, string> = {
  "prev-month": "ຍອດເດືອນກ່ອນ",
  ytd: "ຍອດສະສົມຕົ້ນປີຫາເດືອນກ່ອນ",
  "est-this": "ຄາດຄະເນເດືອນນີ້",
  "est-ytd-this": "ຍອດສະສົມລວມເດືອນນີ້",
  "est-next": "ຄາດຄະເນເດືອນໜ້າ",
  "est-ytd-next": "ຍອດສະສົມລວມເດືອນໜ້າ",
  roy: "ຄາດຄະເນໄລຍະທີ່ເຫຼືອຂອງປີ",
  "full-year": "ຄາດຄະເນຍອດເຕັມປີ",
  banked: "ຍອດຈິງສະສົມທຽບເປົ້າປີ",
  q1: "ຄາດຄະເນໄຕມາດ 1",
  q2: "ຄາດຄະເນໄຕມາດ 2",
  q3: "ຄາດຄະເນໄຕມາດ 3",
  q4: "ຄາດຄະເນໄຕມາດ 4",
  "avg-ytd": "ຍອດສະເລ່ຍຕໍ່ເດືອນ (YTD)",
  "avg-this": "ຍອດສະເລ່ຍຮອດເດືອນນີ້",
  "avg-next": "ຍອດສະເລ່ຍຮອດເດືອນໜ້າ",
  "avg-q1": "ຍອດສະເລ່ຍໄຕມາດ 1",
  "avg-q2": "ຍອດສະເລ່ຍໄຕມາດ 2",
  "avg-q3": "ຍອດສະເລ່ຍໄຕມາດ 3",
  "avg-q4": "ຍອດສະເລ່ຍໄຕມາດ 4",
};

const percent = (value: number, base: number) => (base > 0 ? (value / base) * 100 : null);
const percentText = (value: number, base: number) => {
  const result = percent(value, base);
  return result === null ? "—" : `${result.toFixed(1)}%`;
};
const percentClass = (value: number, base: number) => {
  const result = percent(value, base);
  if (result === null) return "text-odoo-text-muted";
  if (result >= 100) return "text-odoo-success-text";
  if (result >= 90) return "text-odoo-warning-text";
  return "text-odoo-danger-text";
};

function RowLabel({ row }: { row: SummaryRow }) {
  const tone = TONE[row.tone];
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
      <div className="min-w-0">
        <div className="font-black text-odoo-text-strong">{LABELS[row.key] ?? row.label}</div>
        <div className="mt-0.5 truncate text-[10px] font-semibold text-odoo-text-soft">{row.label}</div>
      </div>
    </div>
  );
}

export default function SummaryTable({ rows, year }: { rows: SummaryRow[]; year: number }) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="odoo-table min-w-[920px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="min-w-[270px]">ລາຍການ</th>
              <th className="text-right">ຍອດ/ຄາດຄະເນ</th>
              <th className="text-right">ເປົ້າໝາຍ</th>
              <th className="min-w-[150px]">ຜົນຕໍ່ເປົ້າ</th>
              <th className="text-right">ປີ {year - 1}</th>
              <th className="text-right">ທຽບປີກ່ອນ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const targetPct = percent(row.act, row.target);
              return (
                <tr key={row.key} className={`border-l-4 ${TONE[row.tone].row}`}>
                  <td><RowLabel row={row} /></td>
                  <td className="text-right text-sm font-black tabular-nums text-odoo-text-strong">{fmt.format(Math.round(row.act))}</td>
                  <td className="text-right tabular-nums text-odoo-text-muted">{fmt.format(Math.round(row.target))}</td>
                  <td>
                    <div className={`mb-1.5 text-right text-xs font-black tabular-nums ${percentClass(row.act, row.target)}`}>{percentText(row.act, row.target)}</div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-odoo-primary to-odoo-primary-light" style={{ width: `${Math.min(Math.max(targetPct ?? 0, 0), 100)}%` }} /></div>
                  </td>
                  <td className="text-right tabular-nums text-odoo-text-muted">{fmt.format(Math.round(row.lastYear))}</td>
                  <td className={`text-right text-xs font-black tabular-nums ${percentClass(row.act, row.lastYear)}`}>{percentText(row.act, row.lastYear)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-3 md:hidden">
        {rows.map((row) => {
          const targetPct = percent(row.act, row.target);
          return (
            <article key={row.key} className={`rounded-xl border border-odoo-border-strong border-l-4 p-3 ${TONE[row.tone].row}`}>
              <div className="flex items-start justify-between gap-3"><RowLabel row={row} /><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${TONE[row.tone].badge}`}>{TONE[row.tone].name}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric label="ຍອດ/ຄາດຄະເນ" value={fmt.format(Math.round(row.act))} strong />
                <Metric label="ເປົ້າໝາຍ" value={fmt.format(Math.round(row.target))} />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px]"><span className="font-bold text-odoo-text-muted">ຜົນຕໍ່ເປົ້າ</span><b className={percentClass(row.act, row.target)}>{percentText(row.act, row.target)}</b></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-odoo-primary to-odoo-primary-light" style={{ width: `${Math.min(Math.max(targetPct ?? 0, 0), 100)}%` }} /></div>
              <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-2 text-[10px] text-odoo-text-muted"><span>ປີ {year - 1}: {fmt.format(Math.round(row.lastYear))}</span><b className={percentClass(row.act, row.lastYear)}>{percentText(row.act, row.lastYear)}</b></div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-[9px] font-bold text-odoo-text-muted">{label}</div><div className={`mt-1 tabular-nums ${strong ? "text-base font-black text-odoo-text-strong" : "text-sm font-bold text-odoo-text"}`}>{value}</div></div>;
}
