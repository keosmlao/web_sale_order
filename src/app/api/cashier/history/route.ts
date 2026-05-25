import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/cashier/history — receipt lookup for the in-store cashier.
//
// Query params:
//   q          — match on doc_no OR customer name/phone (ILIKE)
//   from / to  — ISO date strings; filter on ic_trans.create_date_time_now
//   cashier    — exact match on cashier_code
//   status     — 'all' (default), 'settled', 'voided'
//   limit      — default 100, max 500
//
// Output: rows sorted by created_at DESC, joining app_settle_audit so we
// can show void state + payment split in a single hit. Receipts not in
// app_settle_audit (legacy CAKAPs created before Phase A) still surface
// with totals from ic_trans; void flag defaults to false.

type Row = {
  doc_no: string;
  cart_number: string | null;
  create_date_time_now: Date;
  cust_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  cashier_code: string | null;
  cashier_name: string | null;
  total_kip: string | number | null;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
  redeemed_kip: string | number | null;
  is_voided: boolean | null;
  void_doc_no: string | null;
  void_reason: string | null;
  voided_at: Date | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";
  const cashier = url.searchParams.get("cashier")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "all";
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit")) || 100),
  );

  const where: Prisma.Sql[] = [Prisma.sql`t.doc_format_code = 'CAKAP'`];
  if (q) {
    const like = `%${q}%`;
    where.push(
      Prisma.sql`(
        t.doc_no ILIKE ${like}
        OR ar.name_1 ILIKE ${like}
        OR ar.telephone ILIKE ${like}
        OR SUBSTRING(t.doc_no FROM 6) ILIKE ${like}
      )`,
    );
  }
  if (from) {
    where.push(Prisma.sql`t.create_date_time_now >= ${from}::timestamp`);
  }
  if (to) {
    where.push(Prisma.sql`t.create_date_time_now <= ${to}::timestamp`);
  }
  if (cashier) {
    where.push(Prisma.sql`t.cashier_code = ${cashier}`);
  }
  if (status === "settled") {
    where.push(Prisma.sql`COALESCE(sa.is_voided, FALSE) = FALSE`);
  } else if (status === "voided") {
    where.push(Prisma.sql`COALESCE(sa.is_voided, FALSE) = TRUE`);
  }
  const whereSql = Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      t.doc_no,
      SUBSTRING(t.doc_no FROM 6) AS cart_number,
      t.create_date_time_now,
      t.cust_code,
      ar.name_1     AS customer_name,
      ar.telephone  AS customer_phone,
      t.cashier_code,
      emp.fullname_lo AS cashier_name,
      COALESCE(sa.total_kip,     t.total_amount_2) AS total_kip,
      COALESCE(sa.cash_kip,      0)                AS cash_kip,
      COALESCE(sa.transfer_kip,  0)                AS transfer_kip,
      COALESCE(sa.redeemed_kip,  0)                AS redeemed_kip,
      COALESCE(sa.is_voided,     FALSE)            AS is_voided,
      sa.void_doc_no,
      sa.void_reason,
      sa.voided_at
    FROM ic_trans t
    LEFT JOIN ar_customer    ar ON ar.code = t.cust_code
    LEFT JOIN odg_employee   emp ON emp.employee_code = t.cashier_code
    LEFT JOIN app_settle_audit sa ON sa.doc_no = t.doc_no
    ${whereSql}
    ORDER BY t.create_date_time_now DESC
    LIMIT ${limit}
  `;

  return NextResponse.json({
    rows: rows.map((r) => ({
      docNo: r.doc_no,
      cartNumber: r.cart_number,
      createdAt: r.create_date_time_now.toISOString(),
      customerId: r.cust_code,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      cashierCode: r.cashier_code,
      cashierName: r.cashier_name,
      totalKip: r.total_kip ? Number(r.total_kip) : 0,
      cashKip: r.cash_kip ? Number(r.cash_kip) : 0,
      transferKip: r.transfer_kip ? Number(r.transfer_kip) : 0,
      redeemedKip: r.redeemed_kip ? Number(r.redeemed_kip) : 0,
      isVoided: r.is_voided === true,
      voidDocNo: r.void_doc_no,
      voidReason: r.void_reason,
      voidedAt: r.voided_at ? r.voided_at.toISOString() : null,
    })),
  });
}
