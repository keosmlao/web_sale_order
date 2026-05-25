import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/reports/promo-effectiveness
//
// Estimates how each promotion is performing over the given window.
// Joins ic_trans_detail rows whose `discount` text contains the promo
// name (the engine pushes the name there at SOK creation) so we count
// only lines that actually picked up that promo.

type Row = {
  promo_id: bigint;
  promo_name: string;
  promo_type: string;
  is_active: boolean;
  bill_count: bigint | number | null;
  line_count: bigint | number | null;
  total_discount_kip: string | number | null;
  total_kip: string | number | null;
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

  const rows = await prisma.$queryRaw<Row[]>`
    WITH bills AS (
      SELECT
        p.id   AS promo_id,
        p.name AS promo_name,
        p.promo_type,
        p.is_active,
        t.doc_no,
        d.discount_amount_2 AS line_discount,
        d.sum_amount_2      AS line_amount
      FROM app_promotion p
      JOIN ic_trans_detail d ON d.discount ILIKE '%' || p.name || '%'
      JOIN ic_trans t ON t.doc_no = d.doc_no
      WHERE t.doc_format_code = 'CAKAP'
        AND t.create_date_time_now::date >= ${from}::date
        AND t.create_date_time_now::date <= ${to}::date
        AND COALESCE(t.is_cancel, 0) = 0
    )
    SELECT
      promo_id,
      promo_name,
      promo_type,
      is_active,
      COUNT(DISTINCT doc_no) AS bill_count,
      COUNT(*)               AS line_count,
      COALESCE(SUM(line_discount), 0) AS total_discount_kip,
      COALESCE(SUM(line_amount), 0)   AS total_kip
    FROM bills
    GROUP BY promo_id, promo_name, promo_type, is_active
    ORDER BY total_discount_kip DESC
    LIMIT 200
  `;

  // Silence Prisma unused-import warning when the file ends up tagless.
  void Prisma;

  return NextResponse.json({
    from,
    to,
    rows: rows.map((r) => ({
      promoId: r.promo_id.toString(),
      promoName: r.promo_name,
      promoType: r.promo_type,
      isActive: r.is_active,
      billCount: Number(r.bill_count ?? 0),
      lineCount: Number(r.line_count ?? 0),
      totalDiscountKip: Number(r.total_discount_kip ?? 0),
      totalKip: Number(r.total_kip ?? 0),
    })),
  });
}
