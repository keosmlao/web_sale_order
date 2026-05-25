import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/reports/daily-payments
//
// JSON variant of /reports/daily-payments. For a single day, returns every
// CAKAP receipt with its currency × method breakdown plus day totals so the
// mobile app can reconcile against the cash drawer.
//
// Query params:
//   date — ISO YYYY-MM-DD. Default: today in Asia/Vientiane (UTC+7).

type HeaderRow = {
  doc_no: string;
  doc_date: string;
  doc_time: string | null;
  cust_code: string | null;
  customer_name: string | null;
  sale_code: string | null;
  salesperson_name: string | null;
  total_amount_kip: string | number | null;
  is_cancel: number | null;
};

type PaymentLineRow = {
  doc_no: string;
  currency_code: string;
  pay_method: "cash" | "transfer";
  amount: string | number | null;
  amount_in_main: string | number | null;
};

type SlipCountRow = {
  doc_no: string;
  slip_count: number | string;
};

// Currency × payment method buckets. The page only models KIP (02) and
// THB (01) — the same two are returned here so the mobile UI can map
// directly.
type BreakdownKey = "01:cash" | "01:transfer" | "02:cash" | "02:transfer";
const BREAKDOWN_KEYS: BreakdownKey[] = [
  "01:cash",
  "01:transfer",
  "02:cash",
  "02:transfer",
];

function todayInVientiane(): string {
  const now = new Date();
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

const toNum = (v: string | number | null | undefined): number =>
  v == null ? 0 : Number(v) || 0;

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date")?.trim();
  const selectedDate = isValidDate(rawDate) ? rawDate : todayInVientiane();

  // Three parallel queries — same shape as the page. Fan-out is cheap and
  // halves the wall-clock vs. sequential.
  const [headers, payments, slips] = await Promise.all([
    prisma.$queryRaw<HeaderRow[]>`
      SELECT
        t.doc_no,
        TO_CHAR(t.doc_date, 'YYYY-MM-DD') AS doc_date,
        t.doc_time,
        t.cust_code,
        ar.name_1 AS customer_name,
        NULLIF(t.sale_code, '') AS sale_code,
        COALESCE(emp.fullname_lo, emp.nickname, t.sale_code) AS salesperson_name,
        t.total_amount_2 AS total_amount_kip,
        t.is_cancel
      FROM ic_trans t
      LEFT JOIN ar_customer ar ON ar.code = t.cust_code
      LEFT JOIN odg_employee emp ON emp.employee_code = NULLIF(t.sale_code, '')
      WHERE t.doc_format_code = 'CAKAP'
        AND t.doc_date = ${selectedDate}::date
      ORDER BY t.doc_time NULLS LAST, t.doc_no
    `,
    prisma.$queryRaw<PaymentLineRow[]>`
      SELECT
        p.doc_no,
        p.currency_code,
        p.pay_method,
        p.amount,
        p.amount_in_main
      FROM app_payment_line p
      JOIN ic_trans t ON t.doc_no = p.doc_no AND t.doc_format_code = 'CAKAP'
      WHERE t.doc_date = ${selectedDate}::date
    `,
    prisma.$queryRaw<SlipCountRow[]>`
      SELECT s.doc_no, COUNT(*)::int AS slip_count
      FROM app_transfer_slip s
      JOIN ic_trans t ON t.doc_no = s.doc_no AND t.doc_format_code = 'CAKAP'
      WHERE t.doc_date = ${selectedDate}::date
      GROUP BY s.doc_no
    `,
  ]);

  // Per-doc payment lookup so we can stamp the breakdown onto each row.
  const paymentsByDoc = new Map<string, PaymentLineRow[]>();
  for (const p of payments) {
    const list = paymentsByDoc.get(p.doc_no) ?? [];
    list.push(p);
    paymentsByDoc.set(p.doc_no, list);
  }
  const slipsByDoc = new Map<string, number>();
  for (const s of slips) slipsByDoc.set(s.doc_no, Number(s.slip_count));

  function emptyBreakdown(): Record<BreakdownKey, number> {
    return { "01:cash": 0, "01:transfer": 0, "02:cash": 0, "02:transfer": 0 };
  }

  // Day-level totals + breakdown.
  let receiptsActive = 0;
  let receiptsCancelled = 0;
  let kipActive = 0;
  let kipCancelled = 0;
  const dayBreakdown = emptyBreakdown();

  for (const h of headers) {
    const kip = toNum(h.total_amount_kip);
    if (h.is_cancel) {
      receiptsCancelled += 1;
      kipCancelled += kip;
    } else {
      receiptsActive += 1;
      kipActive += kip;
    }
  }
  for (const p of payments) {
    const header = headers.find((h) => h.doc_no === p.doc_no);
    if (!header || header.is_cancel) continue;
    const key = `${p.currency_code}:${p.pay_method}` as BreakdownKey;
    if (BREAKDOWN_KEYS.includes(key)) {
      dayBreakdown[key] += toNum(p.amount);
    }
  }

  // Per-row breakdown — small loop over each header's payment lines.
  function rowBreakdown(docNo: string): Record<BreakdownKey, number> {
    const list = paymentsByDoc.get(docNo) ?? [];
    const r = emptyBreakdown();
    for (const p of list) {
      const key = `${p.currency_code}:${p.pay_method}` as BreakdownKey;
      if (BREAKDOWN_KEYS.includes(key)) {
        r[key] += toNum(p.amount);
      }
    }
    return r;
  }

  return NextResponse.json({
    date: selectedDate,
    totals: {
      receiptsActive,
      receiptsCancelled,
      kipActive,
      kipCancelled,
    },
    breakdown: dayBreakdown,
    rows: headers.map((h) => ({
      docNo: h.doc_no,
      docDate: h.doc_date,
      docTime: h.doc_time,
      custCode: h.cust_code,
      custName: h.customer_name,
      saleCode: h.sale_code,
      salespersonName: h.salesperson_name,
      totalAmountKip: toNum(h.total_amount_kip),
      isCancelled: Boolean(h.is_cancel),
      breakdown: rowBreakdown(h.doc_no),
      slipCount: slipsByDoc.get(h.doc_no) ?? 0,
    })),
  });
}
