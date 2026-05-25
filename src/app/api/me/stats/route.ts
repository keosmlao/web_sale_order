import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type PeriodRow = {
  pending_count: bigint;
  completed_count: bigint;
  cancelled_count: bigint;
  pending_amount: string | number | null;
  completed_amount: string | number | null;
  cancelled_amount: string | number | null;
};

type RankRow = {
  user_owner: string | null;
  fullname_lo: string | null;
  nickname: string | null;
  total: string | number | null;
};

type RecentRow = {
  cart_number: string;
  customer_name: string | null;
  amount: string | number | null;
  status: number | null;
  create_date_time_now: Date;
};

function norm(p: PeriodRow | undefined) {
  return {
    pendingCount: Number(p?.pending_count ?? 0),
    completedCount: Number(p?.completed_count ?? 0),
    cancelledCount: Number(p?.cancelled_count ?? 0),
    pendingAmount: Number(p?.pending_amount ?? 0),
    completedAmount: Number(p?.completed_amount ?? 0),
    cancelledAmount: Number(p?.cancelled_amount ?? 0),
  };
}

export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const code = me.employeeCode ?? "";
  if (!code) {
    return NextResponse.json({ error: "ບໍ່ມີລະຫັດພະນັກງານ" }, { status: 400 });
  }

  const [todayRows, yesterdayRows, monthRows, rankRows, recentRows] =
    await Promise.all([
      prisma.$queryRaw<PeriodRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 0)::bigint AS pending_count,
          COUNT(*) FILTER (WHERE status = 1)::bigint AS completed_count,
          COUNT(*) FILTER (WHERE status = 2)::bigint AS cancelled_count,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 0), 0) AS pending_amount,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 1), 0) AS completed_amount,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 2), 0) AS cancelled_amount
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
        WHERE t.doc_format_code = 'SOK'
          AND create_date_time_now::date = CURRENT_DATE
          AND eff.salesperson_code = ${code}
      `,
      prisma.$queryRaw<PeriodRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 0)::bigint AS pending_count,
          COUNT(*) FILTER (WHERE status = 1)::bigint AS completed_count,
          COUNT(*) FILTER (WHERE status = 2)::bigint AS cancelled_count,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 0), 0) AS pending_amount,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 1), 0) AS completed_amount,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 2), 0) AS cancelled_amount
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
        WHERE t.doc_format_code = 'SOK'
          AND create_date_time_now::date = CURRENT_DATE - INTERVAL '1 day'
          AND eff.salesperson_code = ${code}
      `,
      prisma.$queryRaw<PeriodRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 0)::bigint AS pending_count,
          COUNT(*) FILTER (WHERE status = 1)::bigint AS completed_count,
          COUNT(*) FILTER (WHERE status = 2)::bigint AS cancelled_count,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 0), 0) AS pending_amount,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 1), 0) AS completed_amount,
          COALESCE(SUM(total_amount_2) FILTER (WHERE status = 2), 0) AS cancelled_amount
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
        WHERE t.doc_format_code = 'SOK'
          AND create_date_time_now >= date_trunc('month', CURRENT_DATE)
          AND create_date_time_now < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
          AND eff.salesperson_code = ${code}
      `,
      // Today's team leaderboard — needed to compute the caller's rank.
      // Only active statuses (PENDING + COMPLETED) so the ranking reflects
      // real sales effort.
      prisma.$queryRaw<RankRow[]>`
        SELECT
          eff.salesperson_code AS user_owner,
          emp.fullname_lo,
          emp.nickname,
          COALESCE(SUM(t.total_amount_2), 0) AS total
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
          AND t.create_date_time_now::date = CURRENT_DATE
          AND t.status IN (0, 1)
          AND eff.salesperson_code IS NOT NULL
        GROUP BY eff.salesperson_code, emp.fullname_lo, emp.nickname
        ORDER BY total DESC
      `,
      // My last 5 orders, any status, for the activity feed.
      prisma.$queryRaw<RecentRow[]>`
        SELECT
          SUBSTRING(t.doc_no FROM 6) AS cart_number,
          ar.name_1 AS customer_name,
          t.total_amount_2 AS amount,
          t.status,
          t.create_date_time_now
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
        LEFT JOIN ar_customer ar ON ar.code = t.cust_code
        WHERE t.doc_format_code = 'SOK'
          AND eff.salesperson_code = ${code}
        ORDER BY t.create_date_time_now DESC
        LIMIT 5
      `,
    ]);

  const today = norm(todayRows[0]);
  const yesterday = norm(yesterdayRows[0]);
  const month = norm(monthRows[0]);

  // Ranking — search for my code in the sorted leaderboard. Top performer
  // total is sent back so the UI can render a relative progress bar.
  let myRank = 0;
  let myTodayTotal = 0;
  for (let i = 0; i < rankRows.length; i++) {
    if (rankRows[i].user_owner === code) {
      myRank = i + 1;
      myTodayTotal = Number(rankRows[i].total ?? 0);
      break;
    }
  }
  const totalSalespeople = rankRows.length;
  const topTotal = Number(rankRows[0]?.total ?? 0);
  const topName =
    rankRows[0]?.fullname_lo ||
    rankRows[0]?.nickname ||
    rankRows[0]?.user_owner ||
    null;

  return NextResponse.json({
    today,
    yesterday,
    month,
    rank: {
      myRank,
      totalSalespeople,
      myTodayTotal,
      topTotal,
      topName,
    },
    recent: recentRows.map((r) => ({
      cartNumber: r.cart_number,
      customerName: r.customer_name,
      amount: r.amount ? Number(r.amount) : 0,
      status:
        r.status === 1 ? "COMPLETED" : r.status === 2 ? "CANCELLED" : "PENDING",
      createdAt: r.create_date_time_now,
    })),
  });
}
