import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

type Row = {
  code: string | null;
  name_1: string | null;
  branch_code: string | null;
  od_code: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salesOnly = request.nextUrl.searchParams.get("salesOnly") === "1";
  const salesWarehouses = salesOnly
    ? new Set(await getConfiguredSalesWarehouses())
    : null;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT code, name_1, branch_code, od_code
    FROM ic_warehouse
    WHERE status = 1
      AND code IS NOT NULL
    ORDER BY code
  `;

  return NextResponse.json({
    items: rows
      .filter((r) => r.code !== null)
      .filter((r) => !salesWarehouses || salesWarehouses.has(r.code as string))
      .map((r) => ({
        code: r.code,
        name: r.name_1 ?? r.code,
        branchCode: r.branch_code,
        odCode: r.od_code,
      })),
  });
}
