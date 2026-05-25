import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Source: legacy `public.transport_type` table (raw — not in Prisma schema).
// The '01-%' family is excluded as agreed with ops: those codes represent
// internal-only transport modes that should never appear in the POS picker.
type Row = {
  code: string | null;
  name_1: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT code, name_1
    FROM public.transport_type
    WHERE code NOT LIKE '01-%'
      AND code IS NOT NULL
    ORDER BY code
  `;

  return NextResponse.json({
    items: rows
      .filter((r) => r.code !== null)
      .map((r) => ({
        code: r.code,
        name: r.name_1 ?? r.code,
      })),
  });
}
