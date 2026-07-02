import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

type PointRow = {
  category_code: string;
  brand_code: string;
  design_token: string;
  size_token: string;
  points: string | number;
};

const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
};

// Distinct pick-list values sourced from the reference tables so the editor's
// ໝວດ/ຍີ່ຫໍ້/ດີໄຊ/ຂະໜາດ fields are dropdowns pulled from the database rather
// than free text. Each query is best-effort — a missing table yields [] and
// never breaks the point-map rows.
async function listOptions() {
  const pick = async (q: Promise<Array<{ v: string | null }>>): Promise<string[]> => {
    try {
      const rows = await q;
      return [...new Set(rows.map((r) => (r.v ?? "").trim()).filter(Boolean))];
    } catch {
      return [];
    }
  };
  const [categories, brands, designTokens, sizeTokens] = await Promise.all([
    pick(prisma.$queryRaw`
      SELECT DISTINCT pointmap_category AS v FROM app_incentive_category
      WHERE COALESCE(pointmap_category, '') <> '' ORDER BY 1
    `),
    pick(prisma.$queryRaw`
      SELECT brand_code AS v FROM app_incentive_point_map WHERE COALESCE(brand_code, '') <> ''
      UNION
      SELECT brand_code AS v FROM app_incentive_brand_weight WHERE COALESCE(brand_code, '') <> ''
      ORDER BY 1
    `),
    pick(prisma.$queryRaw`
      SELECT DISTINCT design_token AS v FROM app_incentive_design_token
      WHERE COALESCE(design_token, '') <> '' ORDER BY 1
    `),
    pick(prisma.$queryRaw`
      SELECT DISTINCT size_token AS v FROM app_incentive_size_token
      WHERE COALESCE(size_token, '') <> '' ORDER BY 1
    `),
  ]);
  return { categories, brands, designTokens, sizeTokens };
}

async function listRows() {
  const rows = await prisma.$queryRaw<PointRow[]>`
    SELECT category_code, brand_code, design_token, size_token, points
    FROM app_incentive_point_map
    ORDER BY category_code, brand_code, design_token, size_token
  `;
  const options = await listOptions();
  const rowCats = [...new Set(rows.map((r) => r.category_code))];
  // Category filter list = canonical categories from the reference table, plus
  // any already present in point-map rows (so nothing gets hidden).
  const categories = [...new Set([...options.categories, ...rowCats])];
  return {
    categories,
    options,
    rows: rows.map((r) => ({
      categoryCode: r.category_code,
      brandCode: r.brand_code,
      designToken: r.design_token,
      sizeToken: r.size_token,
      points: Number(r.points),
    })),
  };
}

// Normalise a single point-map key + points from a request body.
function parseRow(body: Record<string, unknown> | null) {
  const categoryCode = String(body?.categoryCode ?? "").trim();
  const brandCode = String(body?.brandCode ?? "").trim().toUpperCase();
  const designToken = String(body?.designToken ?? "").trim();
  const sizeToken = String(body?.sizeToken ?? "").trim();
  const points = Number(body?.points);
  const valid =
    categoryCode.length > 0 &&
    categoryCode.length <= 10 &&
    brandCode.length > 0 &&
    brandCode.length <= 50 &&
    designToken.length <= 40 &&
    sizeToken.length <= 40 &&
    Number.isFinite(points) &&
    points >= 0;
  return { categoryCode, brandCode, designToken, sizeToken, points, valid };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listRows());
  } catch {
    return NextResponse.json(
      { error: "Point-map table missing. Run sql/add-incentive-point-map.sql first." },
      { status: 503 },
    );
  }
}

// Upsert one point-map row (create or update its points).
export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ຄະແນນໂບນັດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const row = parseRow(body);
  if (!row.valid) return NextResponse.json({ error: "ຂໍ້ມູນຄະແນນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  await prisma.$executeRaw`
    INSERT INTO app_incentive_point_map (category_code, brand_code, design_token, size_token, points)
    VALUES (${row.categoryCode}, ${row.brandCode}, ${row.designToken}, ${row.sizeToken}, ${row.points})
    ON CONFLICT (category_code, brand_code, design_token, size_token)
    DO UPDATE SET points = EXCLUDED.points
  `;
  return NextResponse.json(await listRows());
}

export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດລຶບຄະແນນໂບນັດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const row = parseRow(body);
  if (!row.valid) return NextResponse.json({ error: "ຂໍ້ມູນຄະແນນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  await prisma.$executeRaw`
    DELETE FROM app_incentive_point_map
    WHERE category_code = ${row.categoryCode}
      AND brand_code = ${row.brandCode}
      AND design_token = ${row.designToken}
      AND size_token = ${row.sizeToken}
  `;
  return NextResponse.json(await listRows());
}
