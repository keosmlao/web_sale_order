import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/cashier/daily-summary — what the till took on one day, ready to be
// counted and handed over.
//
//   ?date=YYYY-MM-DD   (default: today)
//
// Figures come from the till's own records — app_payment_line for the
// per-currency tender split (what physically landed in the drawer or the
// account, in the currency it arrived in) and app_settle_audit for the
// net KIP totals. Voided receipts are excluded from both. SML-raised
// bills are not in this summary: SML holds their money in THB base with
// no per-currency split, and its own day-close reports them.
//
// ເງິນທອນ (change) is the gap between cash tendered (in KIP terms) and
// the net cash the audit says the bill kept.

type TenderRow = {
  pay_method: string;
  currency_code: string;
  amount: string | number;
  amount_kip: string | number;
  bills: number;
};

type AuditRow = {
  bills: number;
  total_kip: string | number | null;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
  redeemed_kip: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("date")?.trim() ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

  const [tenders, audits] = await Promise.all([
    prisma.$queryRaw<TenderRow[]>`
      SELECT
        p.pay_method,
        p.currency_code,
        SUM(p.amount)          AS amount,
        SUM(p.amount_in_main)  AS amount_kip,
        COUNT(DISTINCT p.doc_no)::int AS bills
      FROM app_payment_line p
      JOIN app_settle_audit sa ON sa.doc_no = p.doc_no
      WHERE sa.is_voided = FALSE
        AND sa.created_at::date = COALESCE(${date}::date, CURRENT_DATE)
      GROUP BY p.pay_method, p.currency_code
      ORDER BY p.pay_method, p.currency_code
    `,
    prisma.$queryRaw<AuditRow[]>`
      SELECT
        COUNT(*)::int        AS bills,
        SUM(total_kip)       AS total_kip,
        SUM(cash_kip)        AS cash_kip,
        SUM(transfer_kip)    AS transfer_kip,
        SUM(redeemed_kip)    AS redeemed_kip
      FROM app_settle_audit
      WHERE is_voided = FALSE
        AND created_at::date = COALESCE(${date}::date, CURRENT_DATE)
    `,
  ]);

  const audit = audits[0];
  const cashKipNet = audit?.cash_kip ? Number(audit.cash_kip) : 0;
  const transferKip = audit?.transfer_kip ? Number(audit.transfer_kip) : 0;
  const cashTenderedKip = tenders
    .filter((t) => t.pay_method === "cash")
    .reduce((s, t) => s + Number(t.amount_kip), 0);

  return NextResponse.json({
    date: date ?? null,
    bills: audit?.bills ?? 0,
    tenders: tenders.map((t) => ({
      payMethod: t.pay_method,
      currencyCode: t.currency_code,
      amount: Number(t.amount),
      amountKip: Number(t.amount_kip),
      bills: t.bills,
    })),
    totalKip: audit?.total_kip ? Number(audit.total_kip) : 0,
    cashKip: cashKipNet,
    transferKip,
    redeemedKip: audit?.redeemed_kip ? Number(audit.redeemed_kip) : 0,
    changeKip: Math.max(0, cashTenderedKip - cashKipNet),
    // What physically leaves the drawer at day close.
    remitKip: cashKipNet,
  });
}
