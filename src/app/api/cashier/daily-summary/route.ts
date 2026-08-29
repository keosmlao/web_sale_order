import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { isPrivilegedRole, roleFromEmployee } from "@/lib/roles";

// /api/cashier/daily-summary — what the till took on one day, ready to be
// counted and handed over.
//
//   ?date=YYYY-MM-DD   (default: today)
//
// Figures come from the till's own records — app_payment_line for the
// per-currency tender split (what physically landed in the drawer or the
// account, in the currency it arrived in) and app_settle_audit for the
// net KIP totals. Voided receipts are excluded from both.
//
// SML-raised bills of the shop are counted too, from their cb_trans
// header: cash_amount and tranfer_amount are THB base, so each is divided
// by the bill's exchange_rate back into KIP. SML keeps no reliable
// per-currency split (its cb_trans_detail doc_types do not reconcile), so
// they contribute one KIP-equivalent line per section, not a split.
//
// ເງິນທອນ (change) is the gap between cash tendered (in KIP terms) and
// the net cash the audit says the bill kept.

import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

type SmlRow = {
  bills: number;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
  total_kip: string | number | null;
};

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

  // Same visibility rule as the receipt list: a cashier counts their own
  // drawer; heads and managers count the shop. '' matches everything so
  // the privileged case needs no separate SQL.
  const privileged = isPrivilegedRole(
    roleFromEmployee({
      appRole: employee.appRole,
      positionCode: employee.positionCode,
    }),
  );
  const own = privileged ? "" : (employee.employeeCode ?? "");

  const salesWhs = await getConfiguredSalesWarehouses();
  const [tenders, audits, smlRows] = await Promise.all([
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
        AND (${own} = '' OR sa.cashier_code = ${own})
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
        AND (${own} = '' OR cashier_code = ${own})
    `,
    prisma.$queryRaw<SmlRow[]>`
      SELECT
        COUNT(*)::int AS bills,
        SUM(c.cash_amount    / NULLIF(t.exchange_rate, 0)) AS cash_kip,
        SUM(c.tranfer_amount / NULLIF(t.exchange_rate, 0)) AS transfer_kip,
        SUM(t.total_amount_2)                              AS total_kip
      FROM ic_trans t
      JOIN cb_trans c ON c.doc_no = t.doc_no AND c.trans_flag = 44
      WHERE t.trans_flag = 44
        AND t.doc_format_code <> 'CAKAP'
        AND t.doc_date = COALESCE(${date}::date, CURRENT_DATE)
        AND (
          ${own} = ''
          OR COALESCE(NULLIF(TRIM(t.last_editor_code), ''), t.cashier_code)
             = ${own}
        )
        AND EXISTS (
          SELECT 1 FROM ic_trans_detail dd
          WHERE dd.doc_no = t.doc_no
            AND dd.trans_flag = 44
            AND dd.wh_code = ANY(${salesWhs})
        )
    `,
  ]);

  const audit = audits[0];
  const cashKipNet = audit?.cash_kip ? Number(audit.cash_kip) : 0;
  const transferKip = audit?.transfer_kip ? Number(audit.transfer_kip) : 0;
  const cashTenderedKip = tenders
    .filter((t) => t.pay_method === "cash")
    .reduce((s, t) => s + Number(t.amount_kip), 0);

  const sml = smlRows[0];
  const smlCashKip = sml?.cash_kip ? Math.round(Number(sml.cash_kip)) : 0;
  const smlTransferKip = sml?.transfer_kip
    ? Math.round(Number(sml.transfer_kip))
    : 0;

  return NextResponse.json({
    date: date ?? null,
    bills: (audit?.bills ?? 0) + (sml?.bills ?? 0),
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
    sml: {
      bills: sml?.bills ?? 0,
      cashKip: smlCashKip,
      transferKip: smlTransferKip,
      totalKip: sml?.total_kip ? Math.round(Number(sml.total_kip)) : 0,
    },
    // What physically leaves the drawer at day close — the till's own net
    // cash plus the SML bills' cash, all in KIP terms.
    remitKip: cashKipNet + smlCashKip,
  });
}
