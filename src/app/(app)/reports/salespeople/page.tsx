import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import SalespeopleClient, { type MonthlyReceiptRow } from "./SalespeopleClient";

export const dynamic ="force-dynamic";

// ສາຂາ (branch) is identified by ic_trans.branch_code — each branch owns its own
// bill-number series (Khua Luang = CAK*/INK*), NOT by department_code (which is
// the product section). ສາຂາຂົວຫຼວງ = branch_code '01'. Branch '02' is wholesale
// (ຄຳຈັນ), so filtering to '01' already drops it.
const KHUA_LUANG_BRANCH_CODE = "01";

// Within the branch the salesperson must also belong to the front-store sales
// team — their HR department on odg_employee = 205 (unit 2051, the 8-person
// front-store team). This excludes other branch-01 teams such as ພູວັນ (dept 207).
const FRONT_STORE_SALES_DEPT = "205";

type SearchParams = {
 from?: string | string[];
 to?: string | string[];
};

// Per-employee realised sales = cashier receipts (ic_trans, trans_flag 44),
// keyed by sale_code = employee_code, aggregated per calendar month (ym), in
// BAHT (total_amount). SOK sale-orders are deliberately NOT included — only real
// realised sales count.
type SmlRow = {
 sale_code: string | null;
 fullname_lo: string | null;
 nickname: string | null;
 position_code: string | null;
 ym: string;
 receipt_count: bigint;
 receipt_baht: string | number | null;
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

 // Realised sales per employee × month for the ຂົວຫຼວງ front-store team, in baht.
 const smlRows = await prisma.$queryRaw<SmlRow[]>`
 SELECT
 t.sale_code,
 emp.fullname_lo,
 emp.nickname,
 emp.position_code,
 to_char(t.doc_date, 'YYYY-MM') AS ym,
 COUNT(*)::bigint AS receipt_count,
 COALESCE(SUM(t.total_amount), 0) AS receipt_baht
 FROM ic_trans t
 JOIN odg_employee emp ON emp.employee_code = NULLIF(NULLIF(t.sale_code, ''), '00000')
 WHERE t.trans_flag = 44
 AND t.branch_code = ${KHUA_LUANG_BRANCH_CODE}
 AND emp.department_code = ${FRONT_STORE_SALES_DEPT}
 AND t.doc_date >= ${from}::date
 AND t.doc_date < (${to}::date + INTERVAL '1 day')
 GROUP BY t.sale_code, emp.fullname_lo, emp.nickname, emp.position_code, to_char(t.doc_date, 'YYYY-MM')
 `;

 // Per-person sales target (odg_retail_target_employee) summed over the months
 // in range. Same source the incentives report uses; AC+CE product groups are
 // added together, taking the latest roworder per (emp, group, month).
 // Best-effort — if the source table is missing, targets fall back to 0.
 type TargetRow = { emp_code: string | null; target: string | number | null };
 let targetRows: TargetRow[] = [];
 try {
   targetRows = await prisma.$queryRaw<TargetRow[]>`
     WITH latest AS (
       SELECT DISTINCT ON (emp_code, product_group, year, month)
         emp_code, target
       FROM odg_retail_target_employee
       WHERE (LPAD(year::text, 4, '0') || '-' || LPAD(month::text, 2, '0'))
             BETWEEN to_char(${from}::date, 'YYYY-MM') AND to_char(${to}::date, 'YYYY-MM')
       ORDER BY emp_code, product_group, year, month, roworder DESC
     )
     SELECT emp_code, COALESCE(SUM(target), 0) AS target
     FROM latest
     GROUP BY emp_code
   `;
 } catch {
   targetRows = [];
 }
 const targetByCode = new Map<string, number>();
 for (const r of targetRows) {
   const code = r.emp_code?.trim();
   if (code) targetByCode.set(code, Number(r.target ?? 0));
 }

 // YTD figures (Jan 1 → today), independent of the range filter: realised
 // receipts and the target sum over the elapsed months of this year.
 type YtdRow = { emp_code: string | null; amount: string | number | null };
 let ytdActualRows: YtdRow[] = [];
 let ytdTargetRows: YtdRow[] = [];
 try {
   [ytdActualRows, ytdTargetRows] = await Promise.all([
     prisma.$queryRaw<YtdRow[]>`
       SELECT t.sale_code AS emp_code, COALESCE(SUM(t.total_amount), 0) AS amount
       FROM ic_trans t
       JOIN odg_employee emp ON emp.employee_code = NULLIF(NULLIF(t.sale_code, ''), '00000')
       WHERE t.trans_flag = 44
         AND t.branch_code = ${KHUA_LUANG_BRANCH_CODE}
         AND emp.department_code = ${FRONT_STORE_SALES_DEPT}
         AND t.doc_date >= date_trunc('year', CURRENT_DATE)
       GROUP BY t.sale_code
     `,
     prisma.$queryRaw<YtdRow[]>`
       WITH latest AS (
         SELECT DISTINCT ON (emp_code, product_group, year, month)
           emp_code, target
         FROM odg_retail_target_employee
         WHERE LPAD(year::text, 4, '0') = to_char(CURRENT_DATE, 'YYYY')
           AND LPAD(month::text, 2, '0') <= to_char(CURRENT_DATE, 'MM')
         ORDER BY emp_code, product_group, year, month, roworder DESC
       )
       SELECT emp_code, COALESCE(SUM(target), 0) AS amount
       FROM latest
       GROUP BY emp_code
     `,
   ]);
 } catch {
   ytdActualRows = [];
   ytdTargetRows = [];
 }
 const ytdActualByCode = new Map<string, number>();
 for (const r of ytdActualRows) {
   const code = r.emp_code?.trim();
   if (code) ytdActualByCode.set(code, Number(r.amount ?? 0));
 }
 const ytdTargetByCode = new Map<string, number>();
 for (const r of ytdTargetRows) {
   const code = r.emp_code?.trim();
   if (code) ytdTargetByCode.set(code, Number(r.amount ?? 0));
 }

 // Front-store roster names — used to show target-holders that have no
 // receipts in the selected range as 0-sales rows.
 const rosterRows = await prisma.$queryRaw<Array<{
   employee_code: string | null;
   fullname_lo: string | null;
   nickname: string | null;
   position_code: string | null;
 }>>`
   SELECT employee_code, fullname_lo, nickname, position_code
   FROM odg_employee
   WHERE department_code = ${FRONT_STORE_SALES_DEPT}
 `;
 const rosterByCode = new Map(
   rosterRows
     .filter((r) => r.employee_code)
     .map((r) => [r.employee_code!.trim(), r]),
 );

 // Fold the (employee × month) rows into one aggregate per employee carrying a
 // month→baht map plus the running bill count.
 type ReceiptAgg = {
 code: string;
 displayName: string;
 positionCode: string | null;
 byMonth: Map<string, number>;
 count: number;
 total: number; // baht
 };
 const monthsSet = new Set<string>();
 const byCode = new Map<string, ReceiptAgg>();
 for (const r of smlRows) {
 const code = r.sale_code?.trim();
 if (!code) continue;
 monthsSet.add(r.ym);
 let agg = byCode.get(code);
 if (!agg) {
 agg = {
 code,
 displayName: r.fullname_lo?.trim() || r.nickname?.trim() || code,
 positionCode: r.position_code,
 byMonth: new Map(),
 count: 0,
 total: 0,
 };
 byCode.set(code, agg);
 }
 const baht = Number(r.receipt_baht ?? 0);
 agg.byMonth.set(r.ym, (agg.byMonth.get(r.ym) ?? 0) + baht);
 agg.count += Number(r.receipt_count);
 agg.total += baht;
 }
 // Target-holders with no receipts in range still get a 0 row (only if they
 // are on the front-store roster).
 for (const [code] of targetByCode) {
   if (byCode.has(code)) continue;
   const emp = rosterByCode.get(code);
   if (!emp) continue;
   byCode.set(code, {
     code,
     displayName: emp.fullname_lo?.trim() || emp.nickname?.trim() || code,
     positionCode: emp.position_code,
     byMonth: new Map(),
     count: 0,
     total: 0,
   });
 }

 const monthly: MonthlyReceiptRow[] = Array.from(byCode.values())
 .map((agg) => ({
 code: agg.code,
 displayName: agg.displayName,
 positionCode: agg.positionCode,
 total: agg.total,
 target: targetByCode.get(agg.code) ?? 0,
 ytdActual: ytdActualByCode.get(agg.code) ?? 0,
 ytdTarget: ytdTargetByCode.get(agg.code) ?? 0,
 }))
 .sort((a, b) => b.total - a.total);

 const grandReceipts = monthly.reduce((s, r) => s + r.total, 0);
 const grandTarget = monthly.reduce((s, r) => s + r.target, 0);
 const grandBills = Array.from(byCode.values()).reduce((s, a) => s + a.count, 0);

 // Days left in the CURRENT month — Req/Day only makes sense while the
 // selected range reaches into it.
 const now = new Date();
 const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
   .toISOString()
   .slice(0, 10);
 const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
 const daysLeft = to >= firstOfMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : null;

 return (
 <SalespeopleClient
 grandReceipts={grandReceipts}
 grandTarget={grandTarget}
 grandBills={grandBills}
 daysLeft={daysLeft}
 monthly={monthly}
 filters={{ from, to }}
 />
 );
}
