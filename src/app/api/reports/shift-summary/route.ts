import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/reports/shift-summary
//
// Aggregates cashier shifts + their settle-audit totals over a date
// range. Powers the "ຍອດຂາຍປະຈຳວັນ/ປະຈຳເດືອນ" view on the cashier
// performance page.
//
// Query params:
//   from / to   — ISO date (inclusive). Defaults: last 30 days.
//   cashier     — optional cashier code filter.
//
// Output: one row per (cashier, day) with bill counts + KIP totals.

type Row = {
  cashier_code: string;
  cashier_name: string | null;
  day: Date;
  bill_count: bigint | number | null;
  voided_count: bigint | number | null;
  total_kip: string | number | null;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
  redeemed_kip: string | number | null;
  promo_kip: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(today.getDate() - 30);
  const from = url.searchParams.get("from")?.trim() ||
    defaultFrom.toISOString().slice(0, 10);
  const to = url.searchParams.get("to")?.trim() ||
    today.toISOString().slice(0, 10);
  const cashier = url.searchParams.get("cashier")?.trim() ?? "";

  const where: Prisma.Sql[] = [
    Prisma.sql`sa.created_at::date >= ${from}::date`,
    Prisma.sql`sa.created_at::date <= ${to}::date`,
  ];
  if (cashier) {
    where.push(Prisma.sql`sa.cashier_code = ${cashier}`);
  }
  const whereSql = Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      sa.cashier_code,
      emp.fullname_lo AS cashier_name,
      sa.created_at::date AS day,
      COUNT(*) FILTER (WHERE NOT sa.is_voided)        AS bill_count,
      COUNT(*) FILTER (WHERE sa.is_voided)            AS voided_count,
      COALESCE(SUM(sa.total_kip)    FILTER (WHERE NOT sa.is_voided), 0) AS total_kip,
      COALESCE(SUM(sa.cash_kip)     FILTER (WHERE NOT sa.is_voided), 0) AS cash_kip,
      COALESCE(SUM(sa.transfer_kip) FILTER (WHERE NOT sa.is_voided), 0) AS transfer_kip,
      COALESCE(SUM(sa.redeemed_kip) FILTER (WHERE NOT sa.is_voided), 0) AS redeemed_kip,
      COALESCE(SUM(sa.promo_kip)    FILTER (WHERE NOT sa.is_voided), 0) AS promo_kip
    FROM app_settle_audit sa
    LEFT JOIN odg_employee emp ON emp.employee_code = sa.cashier_code
    ${whereSql}
    GROUP BY sa.cashier_code, emp.fullname_lo, sa.created_at::date
    ORDER BY day DESC, sa.cashier_code
  `;

  return NextResponse.json({
    from,
    to,
    rows: rows.map((r) => ({
      cashierCode: r.cashier_code,
      cashierName: r.cashier_name?.trim() ?? r.cashier_code,
      day: r.day.toISOString().slice(0, 10),
      billCount: Number(r.bill_count ?? 0),
      voidedCount: Number(r.voided_count ?? 0),
      totalKip: Number(r.total_kip ?? 0),
      cashKip: Number(r.cash_kip ?? 0),
      transferKip: Number(r.transfer_kip ?? 0),
      redeemedKip: Number(r.redeemed_kip ?? 0),
      promoKip: Number(r.promo_kip ?? 0),
    })),
  });
}
