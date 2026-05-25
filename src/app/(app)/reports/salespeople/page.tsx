import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import SalespeopleClient, { type SalespersonStat } from "./SalespeopleClient";

export const dynamic ="force-dynamic";

type SearchParams = {
 from?: string | string[];
 to?: string | string[];
 status?: string | string[]; //"ACTIVE" (default: PENDING+COMPLETED) |"ALL"
};

type Row = {
 user_owner: string | null;
 employee_code: string | null;
 fullname_lo: string | null;
 nickname: string | null;
 position_code: string | null;
 pending_count: bigint;
 completed_count: bigint;
 cancelled_count: bigint;
 pending_amount: string | number | null;
 completed_amount: string | number | null;
 cancelled_amount: string | number | null;
};

function pickString(v: string | string[] | undefined): string {
 if (Array.isArray(v)) return v[0] ??"";
 return v ??"";
}

function defaultFrom(): string {
 // First day of current month — common default for sales reports.
 const d = new Date();
 d.setDate(1);
 return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
 return new Date().toISOString().slice(0, 10);
}

export default async function SalespeopleReportPage({
 searchParams,
}: {
 searchParams: Promise<SearchParams>;
}) {
 await requireEmployee();
 const sp = await searchParams;

 const fromRaw = pickString(sp.from).trim();
 const toRaw = pickString(sp.to).trim();
 const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : defaultFrom();
 const to = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : defaultTo();
 const statusScope = pickString(sp.status).trim().toUpperCase() ==="ALL"
 ?"ALL"
 :"ACTIVE";

 // ACTIVE scope (default) hides cancelled orders so the totals reflect real
 // revenue. ALL includes everything for diagnostic use.
 const statusFilter =
 statusScope ==="ALL"
 ? Prisma.empty
 : Prisma.sql`AND c.status IN (0, 1)`;

 const rows = await prisma.$queryRaw<Row[]>`
 SELECT
 eff.salesperson_code AS user_owner,
 emp.employee_code,
 emp.fullname_lo,
 emp.nickname,
 emp.position_code,
 COUNT(*) FILTER (WHERE c.status = 0)::bigint AS pending_count,
 COUNT(*) FILTER (WHERE c.status = 1)::bigint AS completed_count,
 COUNT(*) FILTER (WHERE c.status = 2)::bigint AS cancelled_count,
 COALESCE(SUM(c.total_amount_2) FILTER (WHERE c.status = 0), 0) AS pending_amount,
 COALESCE(SUM(c.total_amount_2) FILTER (WHERE c.status = 1), 0) AS completed_amount,
 COALESCE(SUM(c.total_amount_2) FILTER (WHERE c.status = 2), 0) AS cancelled_amount
 FROM ic_trans c
 LEFT JOIN LATERAL (
 SELECT COALESCE(
 NULLIF(NULLIF(c.sale_code,''),'00000'),
 NULLIF(NULLIF((
 SELECT d.sale_code
 FROM ic_trans_detail d
 WHERE d.doc_no = c.doc_no
 AND d.trans_type = c.trans_type
 AND d.trans_flag = c.trans_flag
 ORDER BY d.line_number
 LIMIT 1
 ),''),'00000'),
 NULLIF(c.creator_code,'')
 ) AS salesperson_code
 ) eff ON true
 LEFT JOIN odg_employee emp ON emp.employee_code = eff.salesperson_code
 WHERE c.doc_format_code = 'SOK'
 AND c.create_date_time_now >= ${from}::date
 AND c.create_date_time_now < (${to}::date + INTERVAL'1 day')
 ${statusFilter}
 GROUP BY eff.salesperson_code, emp.employee_code, emp.fullname_lo, emp.nickname, emp.position_code
 ORDER BY (
 COALESCE(SUM(c.total_amount_2) FILTER (WHERE c.status = 1), 0)
 + COALESCE(SUM(c.total_amount_2) FILTER (WHERE c.status = 0), 0)
 ) DESC
 `;

 const stats: SalespersonStat[] = rows.map((r) => {
 const pending = Number(r.pending_amount ?? 0);
 const completed = Number(r.completed_amount ?? 0);
 const cancelled = Number(r.cancelled_amount ?? 0);
 const activeTotal = pending + completed;
 const orders = Number(r.pending_count) + Number(r.completed_count);
 return {
 userOwner: r.user_owner,
 employeeCode: r.employee_code,
 displayName:
 r.fullname_lo?.trim() ||
 r.nickname?.trim() ||
 r.user_owner ||
"ບໍ່ລະບຸ",
 positionCode: r.position_code,
 pendingCount: Number(r.pending_count),
 completedCount: Number(r.completed_count),
 cancelledCount: Number(r.cancelled_count),
 pendingAmount: pending,
 completedAmount: completed,
 cancelledAmount: cancelled,
 activeTotal,
 activeOrders: orders,
 avgOrderValue: orders > 0 ? activeTotal / orders : 0,
 };
 });

 const grandTotal = stats.reduce((s, r) => s + r.activeTotal, 0);
 const grandOrders = stats.reduce((s, r) => s + r.activeOrders, 0);

 return (
 <SalespeopleClient
 stats={stats}
 grandTotal={grandTotal}
 grandOrders={grandOrders}
 filters={{ from, to, status: statusScope }}
 />
 );
}
