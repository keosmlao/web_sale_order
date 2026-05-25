import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/reports/daily-sales
//
// JSON variant of /reports/daily-sales. The page renders four cards (totals,
// per-currency, per-salesperson, detail rows) from a single $queryRaw round
// trip; this route returns the same payload so the mobile app can show the
// same summary without server-side rendering.
//
// Query params:
//   date — ISO YYYY-MM-DD. Default: today in Asia/Vientiane (UTC+7).
//
// Scope is fixed to the four front-shop departments at Khua Luang. Excludes
// 2042 (ຂາຍໜ້າຮ້ານອາໄຫຼ່) per the same business rule the page applies.

const INCLUDED_DEPT_CODES = ["2012", "2022", "2032", "2062"] as const;

type Num = number | string | null;

type DailyTotals = {
  doc_count: Num;
  cak_count: Num;
  ink_count: Num;
  cak_total: Num;
  ink_total: Num;
  total: Num;
  total_before_vat: Num;
  total_vat: Num;
};

type CurrencyTotal = {
  currency_code: string | null;
  doc_count: Num;
  total_baht: Num;
  total_native: Num;
};

type SalespersonTotal = {
  sale_code: string | null;
  fullname_lo: string | null;
  nickname: string | null;
  doc_count: Num;
  total_baht: Num;
};

type DetailRow = {
  doc_no: string;
  doc_time: string | null;
  doc_date: string;
  cust_code: string | null;
  cust_name: string | null;
  sale_code: string | null;
  sale_fullname: string | null;
  sale_nickname: string | null;
  currency_code: string | null;
  total_amount: Num;
  total_amount_2: Num;
  total_before_vat: Num;
  total_vat_value: Num;
  cancel_type: number | null;
};

type QueryRow = {
  totals: DailyTotals | null;
  currencies: CurrencyTotal[] | null;
  salespeople: SalespersonTotal[] | null;
  detail_rows: DetailRow[] | null;
};

// Asia/Vientiane (UTC+7) "today" — operators in Laos see the local day.
function todayInVientiane(): string {
  const now = new Date();
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

const toNum = (v: Num | bigint | undefined): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v) || 0;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date")?.trim() ?? "";
  const selectedDate = isValidDate(rawDate) ? rawDate : todayInVientiane();
  const deptList = Prisma.join(INCLUDED_DEPT_CODES);

  // Same single-round-trip CTE the page uses — keeps the data consistent.
  const result = await prisma.$queryRaw<QueryRow[]>`
    WITH base AS (
      SELECT
        t.doc_no, t.doc_time, t.doc_date,
        t.cust_code, t.sale_code,
        t.currency_code,
        t.total_amount, t.total_amount_2,
        t.total_before_vat, t.total_vat_value,
        t.cancel_type
      FROM ic_trans t
      WHERE t.trans_flag = 44
        AND (t.doc_no LIKE 'CAK%' OR t.doc_no LIKE 'INK%')
        AND t.doc_date = ${selectedDate}::date
        AND t.department_code IN (${deptList})
    ),
    totals AS (
      SELECT
        COUNT(*) AS doc_count,
        COUNT(*) FILTER (WHERE doc_no LIKE 'CAK%') AS cak_count,
        COUNT(*) FILTER (WHERE doc_no LIKE 'INK%') AS ink_count,
        COALESCE(SUM(total_amount) FILTER (WHERE doc_no LIKE 'CAK%'), 0) AS cak_total,
        COALESCE(SUM(total_amount) FILTER (WHERE doc_no LIKE 'INK%'), 0) AS ink_total,
        COALESCE(SUM(total_amount), 0) AS total,
        COALESCE(SUM(total_before_vat), 0) AS total_before_vat,
        COALESCE(SUM(total_vat_value), 0) AS total_vat
      FROM base
    ),
    currencies AS (
      SELECT
        LPAD(NULLIF(TRIM(currency_code), ''), 2, '0') AS currency_code,
        COUNT(*) AS doc_count,
        COALESCE(SUM(total_amount), 0) AS total_baht,
        COALESCE(SUM(total_amount_2), 0) AS total_native
      FROM base
      GROUP BY LPAD(NULLIF(TRIM(currency_code), ''), 2, '0')
      ORDER BY total_baht DESC
    ),
    salespeople AS (
      SELECT
        b.sale_code,
        e.fullname_lo,
        e.nickname,
        COUNT(*) AS doc_count,
        COALESCE(SUM(b.total_amount), 0) AS total_baht
      FROM base b
      LEFT JOIN odg_employee e ON e.employee_code = b.sale_code
      GROUP BY b.sale_code, e.fullname_lo, e.nickname
      ORDER BY total_baht DESC
    ),
    detail_rows AS (
      SELECT
        b.doc_no, b.doc_time, b.doc_date,
        b.cust_code,
        c.name_1 AS cust_name,
        b.sale_code,
        e.fullname_lo AS sale_fullname,
        e.nickname AS sale_nickname,
        b.currency_code,
        b.total_amount, b.total_amount_2,
        b.total_before_vat, b.total_vat_value,
        b.cancel_type
      FROM base b
      LEFT JOIN odg_employee e ON e.employee_code = b.sale_code
      LEFT JOIN ar_customer c ON c.code = b.cust_code
      ORDER BY b.doc_time NULLS LAST, b.doc_no
    )
    SELECT
      (SELECT row_to_json(t) FROM totals t) AS totals,
      (SELECT json_agg(c) FROM currencies c) AS currencies,
      (SELECT json_agg(s) FROM salespeople s) AS salespeople,
      (SELECT json_agg(d) FROM detail_rows d) AS detail_rows
  `;

  const row = result[0] ?? { totals: null, currencies: null, salespeople: null, detail_rows: null };
  const totals = row.totals ?? {
    doc_count: 0, cak_count: 0, ink_count: 0, cak_total: 0,
    ink_total: 0, total: 0, total_before_vat: 0, total_vat: 0,
  };

  return NextResponse.json({
    date: selectedDate,
    totals: {
      docCount: toNum(totals.doc_count),
      cakCount: toNum(totals.cak_count),
      inkCount: toNum(totals.ink_count),
      cakTotal: toNum(totals.cak_total),
      inkTotal: toNum(totals.ink_total),
      total: toNum(totals.total),
      totalBeforeVat: toNum(totals.total_before_vat),
      totalVat: toNum(totals.total_vat),
    },
    currencies: (row.currencies ?? []).map((c) => ({
      currencyCode: c.currency_code ?? "",
      docCount: toNum(c.doc_count),
      totalBaht: toNum(c.total_baht),
      totalNative: toNum(c.total_native),
    })),
    salespeople: (row.salespeople ?? []).map((s) => ({
      saleCode: s.sale_code ?? "",
      fullnameLo: s.fullname_lo,
      nickname: s.nickname,
      docCount: toNum(s.doc_count),
      totalBaht: toNum(s.total_baht),
    })),
    rows: (row.detail_rows ?? []).map((d) => ({
      docNo: d.doc_no,
      docDate: d.doc_date,
      docTime: d.doc_time,
      custCode: d.cust_code,
      custName: d.cust_name,
      saleCode: d.sale_code,
      saleFullname: d.sale_fullname,
      saleNickname: d.sale_nickname,
      currencyCode: d.currency_code,
      totalAmount: toNum(d.total_amount),
      totalAmount2: toNum(d.total_amount_2),
      totalBeforeVat: toNum(d.total_before_vat),
      totalVatValue: toNum(d.total_vat_value),
      cancelType: d.cancel_type,
    })),
  });
}
