import { Prisma } from "@/generated/prisma/client";

/**
 * Reporting-month overrides for individual bills — see
 * sql/add-sale-month-override.sql for why they live in their own table rather
 * than as an edit to odg_sale_detail.
 *
 * A bill that was rung up in one month but belongs to the previous one (the
 * order was taken then, the branch approved crediting it back) has to move
 * consistently: the month it counts in, the rule versions it is scored against,
 * and the day it appears on in a trend chart. Otherwise a bill credited to July
 * gets scored with August's point map, and a July-only unit reward never pays.
 * So both helpers here are used together at every target/incentive call site.
 *
 * Deliberately NOT applied to: the daily "ຂາຍມື້ນີ້ / ມື້ວານ" cards, the stock
 * movement report, and the YTD brand list. Those describe what physically sold
 * on a day; an override is an accounting-credit decision, not a claim that the
 * goods left the shelf in a different month.
 */

/**
 * The date a sale reports under: the override if the bill has one, otherwise
 * its real doc_date. Use in SELECT lists, GROUP BY, and anywhere a rule's
 * effective_from/effective_to window is matched.
 *
 * Correlated against a table keyed by doc_no that holds a handful of rows, so
 * the per-row cost is a primary-key probe.
 *
 * @param alias the odg_sale_detail alias at the call site (our own SQL literal,
 *              never user input).
 */
export function saleReportDate(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`COALESCE(
    (SELECT o.report_date FROM app_sale_month_override o WHERE o.doc_no = ${t}.doc_no),
    ${t}.doc_date
  )`;
}

/**
 * "This sale reports in [start, end)" — the override-aware replacement for a
 * plain `doc_date >= start AND doc_date < end`.
 *
 * The obvious spelling — `saleReportDate(alias) >= start AND ... < end`, or the
 * equivalent `(in range AND not moved) OR (moved into range)` — is correct but
 * costs an index range-scan: an OR or a COALESCE over doc_date cannot be an
 * index condition, so the planner falls back to scanning every front-store row
 * ever recorded. Measured on the July storefront query, that was 5k index rows
 * against 124k.
 *
 * So the predicate is a sargable window plus an exact filter. The window is the
 * report range stretched to reach any bill that moved into it, computed by an
 * uncorrelated subquery the planner runs once as an InitPlan; the stretch is
 * derived from the moved bills' real doc_date rather than the recorded
 * original_date, so a later ETL correction to the source date cannot push a
 * bill outside the window and lose it. With no overrides in range the bounds
 * collapse to exactly `start`/`end` and the plan is the one we had before.
 *
 * @param alias the odg_sale_detail alias at the call site (our own SQL literal,
 *              never user input).
 * @param start range start, inclusive.
 * @param end   range end, exclusive.
 */
export function saleReportRange(alias: string, start: Prisma.Sql, end: Prisma.Sql): Prisma.Sql {
  const t = Prisma.raw(alias);
  const movedIn = Prisma.sql`
    FROM odg_sale_detail moved
    JOIN app_sale_month_override o ON o.doc_no = moved.doc_no
    WHERE o.report_date >= ${start} AND o.report_date < ${end}`;
  return Prisma.sql`(
    ${t}.doc_date >= LEAST(${start}, COALESCE((SELECT MIN(moved.doc_date) ${movedIn}), ${start}))
    AND ${t}.doc_date < GREATEST(${end}, COALESCE((SELECT MAX(moved.doc_date) + 1 ${movedIn}), ${end}))
    AND (
      (
        ${t}.doc_date >= ${start} AND ${t}.doc_date < ${end}
        AND NOT EXISTS (SELECT 1 FROM app_sale_month_override o WHERE o.doc_no = ${t}.doc_no)
      )
      OR EXISTS (
        SELECT 1 FROM app_sale_month_override o
        WHERE o.doc_no = ${t}.doc_no
          AND o.report_date >= ${start} AND o.report_date < ${end}
      )
    )
  )`;
}

/** saleReportRange over a calendar month, the shape nearly every report wants. */
export function saleReportMonth(alias: string, year: number, month: number): Prisma.Sql {
  return saleReportRange(
    alias,
    Prisma.sql`make_date(${year}, ${month}, 1)`,
    Prisma.sql`make_date(${year}, ${month}, 1) + INTERVAL '1 month'`
  );
}

/** saleReportRange over the calendar month containing CURRENT_DATE. */
export function saleReportCurrentMonth(alias: string): Prisma.Sql {
  return saleReportRange(
    alias,
    Prisma.sql`date_trunc('month', CURRENT_DATE)`,
    Prisma.sql`date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`
  );
}
