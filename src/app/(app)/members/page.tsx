import { Suspense } from "react";
import { requireEmployee } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import MembersClient from "./MembersClient";

export const dynamic ="force-dynamic";

type Row = {
 code: string;
 name_1: string | null;
 telephone: string | null;
 email: string | null;
 address: string | null;
 group_code: string | null;
 group_name: string | null;
 discount_raw: string | null;
 total_count: bigint;
};

type TierRow = { group_name: string | null; n: bigint };

function parseDiscountPct(raw: string | null): number {
 if (!raw) return 0;
 const cleaned = raw.replace(/[^0-9.-]/g,"").trim();
 const n = Number(cleaned);
 return Number.isFinite(n) ? n : 0;
}

type SearchParams = {
 page?: string | string[];
 pageSize?: string | string[];
 q?: string | string[];
 tier?: string | string[];
};

function pickString(v: string | string[] | undefined): string {
 if (Array.isArray(v)) return v[0] ??"";
 return v ??"";
}

function pickPositiveInt(
 v: string | string[] | undefined,
 fallback: number,
 max: number,
): number {
 const raw = pickString(v);
 if (!raw) return fallback;
 const n = Number.parseInt(raw, 10);
 if (!Number.isFinite(n) || n < 1) return fallback;
 return Math.min(n, max);
}

export default async function MembersPage({
 searchParams,
}: {
 searchParams: Promise<SearchParams>;
}) {
 await requireEmployee();
 const sp = await searchParams;

 const page = pickPositiveInt(sp.page, 1, 1_000_000);
 const pageSize = pickPositiveInt(sp.pageSize, 50, 500);
 const q = pickString(sp.q).trim();
 const tier = pickString(sp.tier).trim();
 const offset = (page - 1) * pageSize;
 const qLike = `%${q.toLowerCase()}%`;
 const tierFilter = tier ==="" || tier ==="ALL" ? null : tier;

 // Single page query (rows + total via COUNT(*) OVER) plus the unfiltered
 // tier facets. Merging count + rows halves the table scans on the
 // ar_customer + ar_customer_detail + ar_group_sub join, which is the
 // bottleneck on this page.
 const [rows, tierRows] = await Promise.all([
 prisma.$queryRaw<Row[]>`
 SELECT
 ar.code,
 ar.name_1,
 ar.telephone,
 ar.email,
 ar.address,
 d.group_sub_1 AS group_code,
 g.name_1 AS group_name,
 COALESCE(
 NULLIF(d.discount_item,''),
 NULLIF(d.discount_bill,''),
 NULLIF(g.discount,'')
 ) AS discount_raw,
 COUNT(*) OVER()::bigint AS total_count
 FROM ar_customer ar
 LEFT JOIN ar_customer_detail d ON d.ar_code = ar.code
 LEFT JOIN ar_group_sub g ON g.code = d.group_sub_1
 WHERE TRIM(ar.reg_group) ILIKE 'member'
 AND NULLIF(TRIM(ar.name_1),'') IS NOT NULL
 AND NULLIF(TRIM(ar.code),'') IS NOT NULL
 AND (${tierFilter}::text IS NULL OR TRIM(g.name_1) = ${tierFilter}::text)
 AND (
 ${q} =''
 OR ar.code ILIKE ${qLike}
 OR COALESCE(ar.name_1,'') ILIKE ${qLike}
 OR COALESCE(ar.telephone,'') ILIKE ${qLike}
 OR COALESCE(g.name_1,'') ILIKE ${qLike}
 )
 ORDER BY g.name_1 NULLS LAST, TRIM(ar.name_1)
 LIMIT ${pageSize} OFFSET ${offset}
 `,
 prisma.$queryRaw<TierRow[]>`
 SELECT TRIM(g.name_1) AS group_name, COUNT(*)::bigint AS n
 FROM ar_customer ar
 LEFT JOIN ar_customer_detail d ON d.ar_code = ar.code
 LEFT JOIN ar_group_sub g ON g.code = d.group_sub_1
 WHERE TRIM(ar.reg_group) ILIKE 'member'
 AND NULLIF(TRIM(ar.name_1),'') IS NOT NULL
 AND NULLIF(TRIM(ar.code),'') IS NOT NULL
 GROUP BY TRIM(g.name_1)
 ORDER BY TRIM(g.name_1) NULLS LAST
 `,
 ]);

 const total = Number(rows[0]?.total_count ?? 0);

 const members = rows.map((r) => ({
 id: r.code.trim(),
 name: r.name_1?.trim() || r.code.trim(),
 phone: r.telephone?.trim() || null,
 email: r.email?.trim() || null,
 address: r.address?.trim() || null,
 groupCode: r.group_code?.trim() || null,
 groupName: r.group_name?.trim() || null,
 discountPct: parseDiscountPct(r.discount_raw),
 }));

 const tiers = tierRows
 .map((t) => ({
 name: t.group_name?.trim() ??"",
 count: Number(t.n ?? 0),
 }))
 .filter((t) => t.name.length > 0);

 const grandTotal = tierRows.reduce((s, r) => s + Number(r.n ?? 0), 0);

 return (
 <Suspense fallback={null}>
 <MembersClient
 members={members}
 tiers={tiers}
 total={total}
 grandTotal={grandTotal}
 page={page}
 pageSize={pageSize}
 query={q}
 tier={tier}
 />
 </Suspense>
 );
}
