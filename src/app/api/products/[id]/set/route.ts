import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

type SetDetailRow = {
  line_number: number | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string | number | null;
  price: string | number | null;
  sum_amount: string | number | null;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const code = decodeURIComponent(id).trim();
  if (!code) {
    return NextResponse.json({ error: "Missing product code" }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<SetDetailRow[]>`
    SELECT
      d.line_number,
      d.ic_code AS item_code,
      i.name_1 AS item_name,
      COALESCE(NULLIF(d.unit_code, ''), i.unit_standard_name) AS unit_code,
      d.qty,
      d.price,
      d.sum_amount
    FROM ic_inventory_set_detail d
    LEFT JOIN ic_inventory i ON i.code = d.ic_code
    WHERE d.ic_set_code = ${code}
      AND COALESCE(d.status, 0) <> 1
    ORDER BY d.line_number NULLS LAST, d.roworder
  `;

  return NextResponse.json({
    productCode: code,
    items: rows.map((row) => ({
      lineNumber: row.line_number ?? 0,
      itemCode: row.item_code,
      itemName: row.item_name ?? row.item_code,
      unitCode: row.unit_code,
      quantity: row.qty ? Number(row.qty) : 0,
      price: row.price ? Number(row.price) : 0,
      amount: row.sum_amount ? Number(row.sum_amount) : 0,
    })),
  });
}
