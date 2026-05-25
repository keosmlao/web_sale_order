import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

type Row = {
  ic_code: string | null;
  balance_qty: string | null;
};

// Authoritative company-wide balance per item.
// Uses sml_ic_function_stock_balance which scans live transactions
// (slower but correct, unlike ic_inventory.balance_qty which can be stale).
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<Row[]>`
    WITH codes AS (
      SELECT string_agg(code, ',') AS list
      FROM ic_inventory
      WHERE name_1 IS NOT NULL
    )
    SELECT ic_code, balance_qty
    FROM public.sml_ic_function_stock_balance(
      ${STOCK_BALANCE_AS_OF_DATE}::date,
      (SELECT list FROM codes)
    )
    WHERE COALESCE(balance_qty, 0) <> 0
  `;

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    items: rows.map((r) => ({
      code: r.ic_code,
      companyBalance: r.balance_qty ? Number(r.balance_qty) : 0,
    })),
  });
}
