import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/reports/items
//
// Item-level sales analytics — which products moved over a date range.
// JSON variant of /reports/items which is currently server-side rendered.
// Returns per-item totals (order count, qty, kip amount) plus a grand total
// so the mobile app can show "top sellers" without re-aggregating client-side.
//
// Query params:
//   from   — ISO YYYY-MM-DD (default: 1st of the current month)
//   to     — ISO YYYY-MM-DD (default: today)
//   status — 'ACTIVE' (default) | 'ALL'. ACTIVE excludes cancelled docs.
//   limit  — 1..500, default 50
//   q      — search across item_code / item_name / brand_name

type Row = {
  item_code: string;
  item_name: string | null;
  unit_name: string | null;
  brand_name: string | null;
  order_count: bigint;
  total_qty: string | number | null;
  total_amount: string | number | null;
};

function defaultFrom(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

const toNum = (v: string | number | null | bigint | undefined): number => {
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
  const fromRaw = url.searchParams.get("from")?.trim() ?? "";
  const toRaw = url.searchParams.get("to")?.trim() ?? "";
  const statusRaw = (url.searchParams.get("status")?.trim() ?? "").toUpperCase();
  const limitRaw = Number(url.searchParams.get("limit"));
  const q = url.searchParams.get("q")?.trim() ?? "";

  const from = isValidDate(fromRaw) ? fromRaw : defaultFrom();
  const to = isValidDate(toRaw) ? toRaw : defaultTo();
  const statusScope = statusRaw === "ALL" ? "ALL" : "ACTIVE";
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
      ? Math.floor(limitRaw)
      : 50;

  // ACTIVE = status IN (0,1) — same gate the page uses.
  const statusFilter = statusScope === "ALL"
    ? Prisma.empty
    : Prisma.sql`AND c.status IN (0, 1)`;

  // Page-side search has a typo (uses `b.name_1` but the JOIN alias is `br`).
  // Fixed here so brand search works from the mobile app.
  const qLike = `%${q.toLowerCase()}%`;
  const searchFilter = q
    ? Prisma.sql`AND (
        LOWER(COALESCE(i.item_code, '')) LIKE ${qLike}
        OR LOWER(COALESCE(p.name_1, '')) LIKE ${qLike}
        OR LOWER(COALESCE(br.name_1, '')) LIKE ${qLike}
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      i.item_code,
      p.name_1 AS item_name,
      p.unit_standard_name AS unit_name,
      br.name_1 AS brand_name,
      COUNT(DISTINCT i.doc_no)::bigint AS order_count,
      COALESCE(SUM(i.qty), 0) AS total_qty,
      COALESCE(SUM(i.sum_amount_2), 0) AS total_amount
    FROM ic_trans_detail i
    INNER JOIN ic_trans c
      ON c.doc_no = i.doc_no
     AND c.trans_type = i.trans_type
     AND c.trans_flag = i.trans_flag
    LEFT JOIN ic_inventory p ON p.code = i.item_code
    LEFT JOIN ic_brand br ON br.code = p.item_brand
    WHERE c.doc_format_code = 'SOK'
      AND c.create_date_time_now >= ${from}::date
      AND c.create_date_time_now < (${to}::date + INTERVAL '1 day')
      ${statusFilter}
      ${searchFilter}
    GROUP BY i.item_code, p.name_1, p.unit_standard_name, br.name_1
    ORDER BY COALESCE(SUM(i.sum_amount_2), 0) DESC, COALESCE(SUM(i.qty), 0) DESC
    LIMIT ${limit}
  `;

  // Grand totals across the returned set so the mobile screen can show a
  // hero stat without iterating client-side.
  let grandQty = 0;
  let grandAmount = 0;
  const rowsOut = rows.map((r) => {
    const qty = toNum(r.total_qty);
    const amt = toNum(r.total_amount);
    grandQty += qty;
    grandAmount += amt;
    return {
      itemCode: r.item_code,
      itemName: r.item_name,
      unitName: r.unit_name,
      brandName: r.brand_name,
      orderCount: toNum(r.order_count),
      totalQty: qty,
      totalAmount: amt,
    };
  });

  return NextResponse.json({
    from,
    to,
    status: statusScope,
    limit,
    q,
    rows: rowsOut,
    grandTotal: grandAmount,
    grandQty,
  });
}
