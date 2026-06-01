import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/reports/salespeople — per-salesperson SOK order totals over a date
// range. Powers the app's Team Rankings screen and the manager dashboard
// "team today" panel.
//
// Query params:
//   from / to — inclusive ISO dates (YYYY-MM-DD). Default: today (Vientiane).
//   status    — accepted for client compatibility; the response always
//               carries the full pending/completed/cancelled breakdown.
//
// Salesperson is derived the same way as /api/me/stats and /api/orders:
// header sale_code → first line's sale_code → creator_code. Amounts are KIP
// (total_amount_2). "active" = pending + completed (cancelled excluded).

type Row = {
  user_owner: string | null;
  position_code: string | null;
  display_name: string | null;
  pending_count: bigint;
  completed_count: bigint;
  cancelled_count: bigint;
  pending_amount: string | number | null;
  completed_amount: string | number | null;
  cancelled_amount: string | number | null;
};

const toNum = (v: string | number | null | bigint | undefined): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v) || 0;
};

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

// Asia/Vientiane (UTC+7) "today" so operators see the local day.
function todayInVientiane(): string {
  const now = new Date();
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from")?.trim() ?? "";
  const toRaw = url.searchParams.get("to")?.trim() ?? "";
  const from = isValidDate(fromRaw) ? fromRaw : todayInVientiane();
  const to = isValidDate(toRaw) ? toRaw : from;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      eff.salesperson_code AS user_owner,
      emp.position_code,
      COALESCE(
        NULLIF(emp.fullname_lo, ''),
        NULLIF(emp.nickname, ''),
        eff.salesperson_code
      ) AS display_name,
      COUNT(*) FILTER (WHERE t.status = 0)::bigint AS pending_count,
      COUNT(*) FILTER (WHERE t.status = 1)::bigint AS completed_count,
      COUNT(*) FILTER (WHERE t.status = 2)::bigint AS cancelled_count,
      COALESCE(SUM(t.total_amount_2) FILTER (WHERE t.status = 0), 0) AS pending_amount,
      COALESCE(SUM(t.total_amount_2) FILTER (WHERE t.status = 1), 0) AS completed_amount,
      COALESCE(SUM(t.total_amount_2) FILTER (WHERE t.status = 2), 0) AS cancelled_amount
    FROM ic_trans t
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(NULLIF(t.sale_code, ''), '00000'),
        NULLIF(NULLIF((
          SELECT d.sale_code FROM ic_trans_detail d
          WHERE d.doc_no = t.doc_no
            AND d.trans_type = t.trans_type
            AND d.trans_flag = t.trans_flag
          ORDER BY d.line_number LIMIT 1
        ), ''), '00000'),
        NULLIF(t.creator_code, '')
      ) AS salesperson_code
    ) eff ON true
    LEFT JOIN odg_employee emp ON emp.employee_code = eff.salesperson_code
    WHERE t.doc_format_code = 'SOK'
      AND t.create_date_time_now >= ${from}::date
      AND t.create_date_time_now < (${to}::date + INTERVAL '1 day')
      AND eff.salesperson_code IS NOT NULL
    GROUP BY eff.salesperson_code, emp.fullname_lo, emp.nickname, emp.position_code
  `;

  const mapped = rows.map((r) => {
    const pendingCount = toNum(r.pending_count);
    const completedCount = toNum(r.completed_count);
    const cancelledCount = toNum(r.cancelled_count);
    const pendingAmount = toNum(r.pending_amount);
    const completedAmount = toNum(r.completed_amount);
    const cancelledAmount = toNum(r.cancelled_amount);
    const activeTotal = pendingAmount + completedAmount;
    const activeOrders = pendingCount + completedCount;
    return {
      userOwner: r.user_owner,
      employeeCode: r.user_owner,
      displayName: r.display_name ?? "—",
      positionCode: r.position_code,
      pendingCount,
      completedCount,
      cancelledCount,
      pendingAmount,
      completedAmount,
      cancelledAmount,
      activeTotal,
      activeOrders,
      avgOrderValue: activeOrders > 0 ? activeTotal / activeOrders : 0,
    };
  });

  mapped.sort((a, b) => b.activeTotal - a.activeTotal);

  const grandTotal = mapped.reduce((s, r) => s + r.activeTotal, 0);
  const grandOrders = mapped.reduce((s, r) => s + r.activeOrders, 0);

  return NextResponse.json({ rows: mapped, grandTotal, grandOrders });
}
