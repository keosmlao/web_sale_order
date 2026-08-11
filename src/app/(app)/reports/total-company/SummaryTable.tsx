import type { RowTone, SummaryRow } from "@/lib/company-summary";
import { fmt } from "@/lib/incentive-period";

// Colour bands carried over from the workbook, so someone who reads the Excel
// every morning finds the same rows in the same colours here.
const TONE_ROW: Record<RowTone, string> = {
  actual: "bg-emerald-50",
  estimate: "bg-amber-50",
  forecast: "bg-orange-50",
  annual: "bg-rose-50",
  quarter: "bg-amber-50/60",
  average: "",
};

const TONE_LABEL: Record<RowTone, string> = {
  actual: "font-semibold text-emerald-900",
  estimate: "font-semibold text-amber-900",
  forecast: "font-semibold text-orange-900",
  annual: "font-semibold text-rose-900",
  quarter: "font-medium text-amber-900",
  average: "font-semibold text-odoo-text-strong",
};

const pct = (value: number, base: number) =>
  base > 0 ? `${(( value / base) * 100).toFixed(1)}%` : "—";

const pctClass = (value: number, base: number) =>
  base > 0 && value / base >= 1
    ? "text-emerald-600 font-semibold"
    : "text-red-600 font-semibold";

export default function SummaryTable({
  rows,
  year,
}: {
  rows: SummaryRow[];
  year: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="odoo-table">
        <thead>
          <tr>
            <th className="min-w-[190px]">&nbsp;</th>
            <th className="text-right">ACT</th>
            <th className="text-right">Target</th>
            <th className="text-right">%</th>
            <th className="text-right">Last_Year{year - 1}</th>
            <th className="text-right">
              {year}/{year - 1}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            // The workbook leaves a blank line before the quarters and before
            // the averages; keep those breaks so the blocks stay readable.
            const previous = rows[index - 1];
            const isNewBlock =
              previous !== undefined &&
              previous.tone !== row.tone &&
              (row.tone === "quarter" || row.tone === "average");
            return (
              <tr
                key={row.key}
                className={`${TONE_ROW[row.tone]} ${isNewBlock ? "border-t-4 border-t-odoo-border-strong" : ""}`}
              >
                <td className={TONE_LABEL[row.tone]}>{row.label}</td>
                <td className="text-right tabular-nums">{fmt.format(Math.round(row.act))}</td>
                <td className="text-right tabular-nums text-odoo-text-muted">
                  {fmt.format(Math.round(row.target))}
                </td>
                <td className={`text-right tabular-nums ${pctClass(row.act, row.target)}`}>
                  {pct(row.act, row.target)}
                </td>
                <td className="text-right tabular-nums text-odoo-text-muted">
                  {fmt.format(Math.round(row.lastYear))}
                </td>
                <td className={`text-right tabular-nums ${pctClass(row.act, row.lastYear)}`}>
                  {pct(row.act, row.lastYear)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
