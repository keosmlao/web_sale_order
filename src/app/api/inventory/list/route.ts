import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Paginated stock-on-hand listing for the web inventory page. Reads
// ສິນຄ້າຄົງເຫຼືອ from ic_inventory.balance_qty (cached company balance) plus
// the latest active KIP price. Separate from /api/inventory/search (which the
// POS pickers consume and must keep returning a bare array) so this can
// return { items, total, page, pageSize, totalPages } for the pager.
type Row = {
  code: string;
  name_1: string | null;
  name_eng_1: string | null;
  unit_standard_name: string | null;
  item_brand: string | null;
  item_category: string | null;
  balance_qty: string | number | null;
  sale_price_kip: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(sp.get("pageSize")) || 50));
  const offset = (page - 1) * pageSize;
  const groupMain = (sp.get("groupMain") ?? "").trim();
  const groupSub = (sp.get("groupSub") ?? "").trim();
  const groupSub2 = (sp.get("groupSub2") ?? "").trim();
  const category = (sp.get("category") ?? "").trim();
  const brand = (sp.get("brand") ?? "").trim();
  // all | in | out — the reference screen lists the whole catalog and lets
  // ໝົດ read as a state, not as an item that ceased to exist.
  const stock = (sp.get("stock") ?? "all").trim();

  // Reusable filter + ordering so the COUNT and the page query stay in sync.
  const like = `%${q}%`;
  const conds: Prisma.Sql[] = [Prisma.sql`i.name_1 IS NOT NULL`];
  if (q) {
    conds.push(Prisma.sql`(
      i.code ILIKE ${like}
      OR COALESCE(i.name_1, '') ILIKE ${like}
      OR COALESCE(i.name_eng_1, '') ILIKE ${like}
      OR COALESCE(i.item_brand, '') ILIKE ${like}
    )`);
  }
  if (groupMain) conds.push(Prisma.sql`i.group_main = ${groupMain}`);
  if (groupSub) conds.push(Prisma.sql`i.group_sub = ${groupSub}`);
  if (groupSub2) conds.push(Prisma.sql`i.group_sub2 = ${groupSub2}`);
  if (category) conds.push(Prisma.sql`i.item_category = ${category}`);
  if (brand) conds.push(Prisma.sql`i.item_brand = ${brand}`);
  if (stock === "in") conds.push(Prisma.sql`COALESCE(i.balance_qty, 0) > 0`);
  if (stock === "out") conds.push(Prisma.sql`COALESCE(i.balance_qty, 0) <= 0`);
  const where = Prisma.join(conds, " AND ");
  const orderBy = q
    ? Prisma.sql`ORDER BY CASE WHEN i.code ILIKE ${like} THEN 0 ELSE 1 END, i.code`
    : Prisma.sql`ORDER BY i.code`;

  const [countRows, pageRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM ic_inventory i WHERE ${where}
    `,
    prisma.$queryRaw<Row[]>`
      SELECT
        i.code,
        i.name_1,
        i.name_eng_1,
        i.unit_standard_name,
        i.item_brand,
        i.item_category,
        i.balance_qty,
        price.sale_price_kip
      FROM ic_inventory i
      LEFT JOIN LATERAL (
        SELECT ipp.sale_price1 AS sale_price_kip
        FROM ic_inventory_price ipp
        WHERE ipp.ic_code = i.code
          AND ipp.currency_code = '02'
          AND COALESCE(ipp.sale_price1, 0) > 0
          AND COALESCE(ipp.status, 1) = 1
        ORDER BY
          COALESCE(ipp.to_date, '2099-12-31'::date) DESC,
          COALESCE(ipp.from_date, '1900-01-01'::date) DESC,
          COALESCE(ipp.create_date_time_now, ipp.create_now) DESC,
          ipp.roworder DESC
        LIMIT 1
      ) price ON true
      WHERE ${where}
      ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}
    `,
  ]);

  const total = countRows[0]?.total ?? 0;
  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: pageRows.map((r) => ({
      code: r.code,
      nameLo: r.name_1,
      nameEng: r.name_eng_1,
      unitName: r.unit_standard_name,
      brand: r.item_brand,
      category: r.item_category,
      companyBalance: r.balance_qty ? Number(r.balance_qty) : 0,
      salePriceKip: r.sale_price_kip ? Number(r.sale_price_kip) : 0,
    })),
  });
}
