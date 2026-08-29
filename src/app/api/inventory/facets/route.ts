import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// The dropdowns of the stock screen: groups, categories, brands — codes
// with their names, fetched once when the page opens. Brands come from
// the catalog itself (distinct), everything else from its name table.

type CodeName = { code: string; name_1: string | null };

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [groups, subs, subs2, categories, brands] = await Promise.all([
    prisma.$queryRaw<CodeName[]>`
      SELECT code, name_1 FROM ic_group WHERE COALESCE(name_1,'') <> '' ORDER BY code
    `,
    prisma.$queryRaw<CodeName[]>`
      SELECT code, name_1 FROM ic_group_sub WHERE COALESCE(name_1,'') <> '' ORDER BY code
    `,
    prisma.$queryRaw<CodeName[]>`
      SELECT code, name_1 FROM ic_group_sub2 WHERE COALESCE(name_1,'') <> '' ORDER BY code
    `,
    prisma.$queryRaw<CodeName[]>`
      SELECT code, name_1 FROM ic_category WHERE COALESCE(name_1,'') <> '' ORDER BY code
    `,
    prisma.$queryRaw<Array<{ brand: string }>>`
      SELECT DISTINCT item_brand AS brand FROM ic_inventory
      WHERE COALESCE(item_brand,'') <> '' ORDER BY 1
    `,
  ]);

  const pack = (rows: CodeName[]) =>
    rows.map((r) => ({ code: r.code, name: r.name_1 ?? r.code }));
  return NextResponse.json({
    groups: pack(groups),
    subs: pack(subs),
    subs2: pack(subs2),
    categories: pack(categories),
    brands: brands.map((b) => b.brand),
  });
}
