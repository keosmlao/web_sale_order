import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type ProvinceRow = { code: string; name_1: string | null };
type AmperRow = {
  code: string;
  name_1: string | null;
  province: string | null;
};
type TambonRow = {
  code: string;
  name_1: string | null;
  amper: string | null;
  province: string | null;
};

// Address lookup for the POS new-member form. Returns the two small tables
// (erp_province ~20 rows, erp_amper ~149 rows) up front so the cascading
// dropdowns can render instantly; erp_tambon (~10k rows) is fetched on
// demand once the cashier picks a district to keep the payload tight.
//
//   GET /api/locations            → { provinces, ampers }
//   GET /api/locations?amper=XXX  → { tambons } for that district
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const amper = (request.nextUrl.searchParams.get("amper") ?? "").trim();

  if (amper) {
    const tambons = await prisma.$queryRaw<TambonRow[]>`
      SELECT code, name_1, amper, province
      FROM erp_tambon
      WHERE COALESCE(status, 0) = 0
        AND amper = ${amper}
        AND NULLIF(TRIM(name_1), '') IS NOT NULL
      ORDER BY name_1
    `;
    return NextResponse.json({
      tambons: tambons.map((t) => ({
        code: t.code,
        name: t.name_1?.trim() ?? "",
        amper: t.amper,
        province: t.province,
      })),
    });
  }

  const [provinces, ampers] = await Promise.all([
    prisma.$queryRaw<ProvinceRow[]>`
      SELECT code, name_1
      FROM erp_province
      WHERE COALESCE(status, 0) = 0
        AND NULLIF(TRIM(name_1), '') IS NOT NULL
      ORDER BY name_1
    `,
    prisma.$queryRaw<AmperRow[]>`
      SELECT code, name_1, province
      FROM erp_amper
      WHERE COALESCE(status, 0) = 0
        AND NULLIF(TRIM(name_1), '') IS NOT NULL
      ORDER BY name_1
    `,
  ]);

  return NextResponse.json({
    provinces: provinces.map((p) => ({
      code: p.code,
      name: p.name_1?.trim() ?? "",
    })),
    ampers: ampers.map((a) => ({
      code: a.code,
      name: a.name_1?.trim() ?? "",
      province: a.province,
    })),
  });
}
