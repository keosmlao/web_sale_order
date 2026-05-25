import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import ItemsReportClient, { type ItemStat } from "./ItemsReportClient";

export const dynamic ="force-dynamic";

type Row = {
 item_code: string;
 item_name: string | null;
 unit_name: string | null;
 brand_name: string | null;
 order_count: bigint;
 total_qty: string | number | null;
 total_amount: string | number | null;
};

type SearchParams = {
 from?: string | string[];
 to?: string | string[];
 status?: string | string[]; //'ACTIVE' (default) |'ALL'
 limit?: string | string[];
 q?: string | string[];
};

function pickString(v: string | string[] | undefined): string {
 if (Array.isArray(v)) return v[0] ??"";
 return v ??"";
}

function defaultFrom(): string {
 const d = new Date();
 d.setDate(1);
 return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
 return new Date().toISOString().slice(0, 10);
}

export default async function ItemsReportPage({
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
 const statusScope =
 pickString(sp.status).trim().toUpperCase() ==="ALL" ? "ALL" : "ACTIVE";
 const limitRaw = Number(pickString(sp.limit));
 const limit =
 Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
 ? Math.floor(limitRaw)
 : 50;
 const q = pickString(sp.q).trim();

 const statusFilter =
 statusScope ==="ALL"
 ? Prisma.empty
 : Prisma.sql`AND c.status IN (0, 1)`;

 const qLike = `%${q.toLowerCase()}%`;
 const searchFilter = q
 ? Prisma.sql`AND (
 LOWER(COALESCE(i.item_code,'')) LIKE ${qLike}
 OR LOWER(COALESCE(p.name_1,'')) LIKE ${qLike}
 OR LOWER(COALESCE(b.name_1,'')) LIKE ${qLike}
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
 AND c.create_date_time_now < (${to}::date + INTERVAL'1 day')
 ${statusFilter}
 ${searchFilter}
 GROUP BY i.item_code, p.name_1, p.unit_standard_name, br.name_1
 ORDER BY COALESCE(SUM(i.sum_amount_2), 0) DESC, COALESCE(SUM(i.qty), 0) DESC
 LIMIT ${limit}
 `;

 const items: ItemStat[] = rows.map((r) => ({
 itemCode: r.item_code,
 itemName: r.item_name,
 unitName: r.unit_name,
 brandName: r.brand_name,
 orderCount: Number(r.order_count),
 totalQty: Number(r.total_qty ?? 0),
 totalAmount: Number(r.total_amount ?? 0),
 }));

 const grandTotal = items.reduce((s, r) => s + r.totalAmount, 0);
 const grandQty = items.reduce((s, r) => s + r.totalQty, 0);

 return (
 <ItemsReportClient
 items={items}
 grandTotal={grandTotal}
 grandQty={grandQty}
 filters={{ from, to, status: statusScope, limit, q }}
 />
 );
}
