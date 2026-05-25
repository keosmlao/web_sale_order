import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type MemberRow = {
  code: string;
  name_1: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
  group_code: string | null;
  group_name: string | null;
  discount_raw: string | null;
};

function parseDiscountPct(raw: string | null): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.-]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toMember(row: MemberRow) {
  const discountPct = parseDiscountPct(row.discount_raw);
  return {
    id: row.code.trim(),
    name: row.name_1?.trim() || row.code.trim(),
    phone: row.telephone?.trim() || null,
    email: row.email?.trim() || null,
    address: row.address?.trim() || null,
    groupCode: row.group_code?.trim() || null,
    groupName: row.group_name?.trim() || null,
    discountPct,
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<MemberRow[]>`
    SELECT
      ar.code,
      ar.name_1,
      ar.telephone,
      ar.email,
      ar.address,
      d.group_sub_1 AS group_code,
      g.name_1 AS group_name,
      NULLIF(d.discount_item, '') AS discount_raw
    FROM ar_customer ar
    LEFT JOIN ar_customer_detail d ON d.ar_code = ar.code
    LEFT JOIN ar_group_sub g ON g.code = d.group_sub_1
    WHERE LOWER(TRIM(COALESCE(ar.reg_group, ''))) = 'member'
      AND NULLIF(TRIM(ar.name_1), '') IS NOT NULL
      AND NULLIF(TRIM(ar.code), '') IS NOT NULL
    ORDER BY g.name_1 NULLS LAST, TRIM(ar.name_1)
    LIMIT 20000
  `;

  return NextResponse.json(rows.map(toMember));
}
