// Row maths for the "Total Company" summary (ໜ້າສະຫລຸບຍອດຂາຍທັງບໍລິສັດ), a
// direct port of the boss's Total Company workbook sheet.
//
// The sheet mixes three kinds of month into one column: months already closed
// carry their real ACT, the in-progress month and every month after it carry an
// estimate. Everything below — YTD, the EST+YTD ladder, ROY, the full year, the
// quarters and the averages — is built from that one blended series, which is
// why they always reconcile with each other on screen.
//
// ACT is the whole company: every odg_sale_detail line, no branch / argroup /
// item filter. Verified against the workbook — 8/2025 and 9/2025 come back as
// 57,933,477 and 69,233,529, matching its Last_Year column exactly.

/** Visual grouping, mirroring the colour bands the workbook uses. */
export type RowTone =
  | "actual" // closed months (green)
  | "estimate" // the in-progress month (yellow)
  | "forecast" // next month (orange)
  | "annual" // ROY / full year / year-to-date vs annual target (red)
  | "quarter"
  | "average";

export type SummaryRow = {
  key: string;
  label: string;
  act: number;
  target: number;
  lastYear: number;
  tone: RowTone;
};

export type SummaryInput = {
  year: number;
  /** Jan..Dec actuals for `year`, index 0 = January. */
  act: number[];
  /** Jan..Dec actuals for `year - 1`. */
  lastYear: number[];
  /** Jan..Dec targets for `year`. */
  target: number[];
  /** Months already closed — 7 while August is running. */
  completeThrough: number;
  /**
   * What to use for the in-progress month. `null` reproduces the workbook,
   * which simply carries the target across (so that row always reads 100%).
   * A number overrides it with a live run-rate projection.
   */
  currentMonthEstimate: number | null;
};

const MONTHS = 12;

/** Inclusive 1-based month sum, e.g. `total(act, 1, 7)` = Jan..Jul. */
function total(series: number[], from: number, to: number): number {
  let sum = 0;
  for (let m = Math.max(1, from); m <= Math.min(MONTHS, to); m++) {
    sum += series[m - 1] ?? 0;
  }
  return sum;
}

export function buildSummaryRows(input: SummaryInput): SummaryRow[] {
  const { year, act, lastYear, target, completeThrough, currentMonthEstimate } = input;
  const closed = Math.max(0, Math.min(MONTHS, completeThrough));
  const thisMonth = closed + 1; // the month being estimated
  const nextMonth = thisMonth + 1;

  // The blended series every figure below is derived from: real money up to
  // the last closed month, estimates after it.
  const blended = Array.from({ length: MONTHS }, (_, i) => {
    const m = i + 1;
    if (m <= closed) return act[i] ?? 0;
    if (m === thisMonth && currentMonthEstimate !== null) return currentMonthEstimate;
    return target[i] ?? 0;
  });

  const rows: SummaryRow[] = [];
  const push = (
    key: string,
    label: string,
    tone: RowTone,
    figures: { act: number; target: number; lastYear: number },
  ) => rows.push({ key, label, tone, ...figures });

  /** A row covering months `from`..`to` of the blended series. */
  const span = (from: number, to: number) => ({
    act: total(blended, from, to),
    target: total(target, from, to),
    lastYear: total(lastYear, from, to),
  });

  if (closed >= 1) {
    push("prev-month", `PreviousMonth_${closed}/${year}`, "actual", span(closed, closed));
    push("ytd", `YTD ເດືອນປິດ 1_${closed}/${year}`, "actual", span(1, closed));
  }

  if (thisMonth <= MONTHS) {
    push("est-this", `Est.This month_${thisMonth}/${year}`, "estimate", span(thisMonth, thisMonth));
    push("est-ytd-this", `EST+YTDmonth1_${thisMonth}/${year}`, "estimate", span(1, thisMonth));
  }

  if (nextMonth <= MONTHS) {
    push("est-next", `Est.Next month_${nextMonth}/${year}`, "forecast", span(nextMonth, nextMonth));
    push("est-ytd-next", `EST+YTDmonth1_${nextMonth}/${year}`, "forecast", span(1, nextMonth));
  }

  // Rest of year — everything after the two months forecast individually.
  if (nextMonth + 1 <= MONTHS) {
    push("roy", `ROY${nextMonth + 1}_12/${year}`, "annual", span(nextMonth + 1, MONTHS));
  }

  push("full-year", `FULL year 1_12/${year}`, "annual", span(1, MONTHS));

  // The one row that is NOT forecast: real money in closed months, measured
  // against the whole year's target. The in-progress month remains forecast.
  push("banked", "ຍອດຂາຍສະສົມ/ເປົ້າປີ", "annual", {
    act: total(act, 1, closed),
    target: total(target, 1, MONTHS),
    lastYear: total(lastYear, 1, MONTHS),
  });

  for (let q = 1; q <= 4; q++) {
    const from = (q - 1) * 3 + 1;
    push(`q${q}`, `EST_Q${q}`, "quarter", span(from, from + 2));
  }

  const average = (
    key: string,
    label: string,
    from: number,
    to: number,
    months: number,
  ) => {
    if (months <= 0) return;
    const s = span(from, to);
    push(key, label, "average", {
      act: s.act / months,
      target: s.target / months,
      lastYear: s.lastYear / months,
    });
  };

  if (closed >= 1) average("avg-ytd", `AVG1-${closed}/${year}`, 1, closed, closed);
  if (thisMonth <= MONTHS) {
    average("avg-this", `AVG1-${thisMonth}/${year}`, 1, thisMonth, thisMonth);
  }
  if (nextMonth <= MONTHS) {
    average("avg-next", `AVG1-${nextMonth}/${year}`, 1, nextMonth, nextMonth);
  }
  for (let q = 1; q <= 4; q++) {
    const from = (q - 1) * 3 + 1;
    average(`avg-q${q}`, `AVG${from}-${from + 2}/${year}`, from, from + 2, 3);
  }

  return rows;
}

/**
 * Project a partial month forward. Divides by the days that actually carry
 * sales rather than by today's date, so a month whose data has not synced up
 * to today is not scaled down by the missing tail.
 */
export function projectMonth(
  monthToDate: number,
  daysWithData: number,
  daysInMonth: number,
): number | null {
  if (daysWithData <= 0 || monthToDate <= 0) return null;
  if (daysWithData >= daysInMonth) return monthToDate;
  return (monthToDate / daysWithData) * daysInMonth;
}
