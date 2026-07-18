import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

type RuleRow = { id: bigint; category_code: string; brand_code: string; design_token: string; size_token: string; effective_from: string; effective_to: string; points: string | number; is_special: boolean };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => employee && ["manager", "head"].includes(roleFromEmployee(employee));

async function listOptions() {
  const pick = async (query: Promise<Array<{ v: string | null }>>) => {
    try { return [...new Set((await query).map((row) => (row.v ?? "").trim()).filter(Boolean))]; } catch { return []; }
  };
  const [categories, brands, designTokens, sizeTokens] = await Promise.all([
    pick(prisma.$queryRaw`SELECT DISTINCT pointmap_category AS v FROM app_incentive_category WHERE COALESCE(pointmap_category, '') <> '' ORDER BY 1`),
    pick(prisma.$queryRaw`SELECT DISTINCT brand_code AS v FROM app_incentive_point_rule ORDER BY 1`),
    pick(prisma.$queryRaw`SELECT DISTINCT design_token AS v FROM app_incentive_design_token WHERE COALESCE(design_token, '') <> '' ORDER BY 1`),
    pick(prisma.$queryRaw`SELECT DISTINCT size_token AS v FROM app_incentive_size_token WHERE COALESCE(size_token, '') <> '' ORDER BY 1`),
  ]);
  return { categories, brands, designTokens, sizeTokens };
}

async function listRows(year = 0, month = 0) {
  const rows = await prisma.$queryRaw<RuleRow[]>`SELECT id, category_code, brand_code, design_token, size_token, effective_from::text, effective_to::text, points, is_special FROM app_incentive_point_rule WHERE (${year}=0 OR ${month}=0 OR (effective_from < make_date(${year},${month},1) + INTERVAL '1 month' AND effective_to >= make_date(${year},${month},1))) ORDER BY is_special DESC, effective_from DESC, category_code, brand_code`;
  const options = await listOptions();
  return { categories: options.categories, options, rows: rows.map((row) => ({ id: row.id.toString(), categoryCode: row.category_code, brandCode: row.brand_code, designToken: row.design_token, sizeToken: row.size_token, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, points: Number(row.points), isSpecial: row.is_special })) };
}

function parse(body: Record<string, unknown> | null) {
  const id = String(body?.id ?? "");
  const categoryCode = String(body?.categoryCode ?? "").trim();
  const brandCode = String(body?.brandCode ?? "").trim().toUpperCase();
  const designToken = String(body?.designToken ?? "").trim();
  const sizeToken = String(body?.sizeToken ?? "").trim();
  const effectiveFrom = String(body?.effectiveFrom ?? "");
  const isSpecial = Boolean(body?.isSpecial);
  const effectiveTo = isSpecial ? effectiveFrom : String(body?.effectiveTo ?? "");
  const points = Number(body?.points);
  const valid = categoryCode.length > 0 && categoryCode.length <= 10 && brandCode.length > 0 && brandCode.length <= 50 && designToken.length <= 40 && sizeToken.length <= 40 && DATE_RE.test(effectiveFrom) && DATE_RE.test(effectiveTo) && effectiveTo >= effectiveFrom && Number.isFinite(points) && points >= 0;
  return { id, categoryCode, brandCode, designToken, sizeToken, effectiveFrom, effectiveTo, points, isSpecial, valid };
}

export async function GET(request: NextRequest) {
  if (!await getEmployeeFromRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  try { return NextResponse.json(await listRows(Number(url.searchParams.get("year")), Number(url.searchParams.get("month")))); } catch { return NextResponse.json({ error: "Run sql/add-pointmap-date-ranges.sql first" }, { status: 503 }); }
}

export async function PUT(request: NextRequest) {
  if (!canManage(await getEmployeeFromRequest(request))) return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ຄະແນນໂບນັດ" }, { status: 403 });
  const rule = parse(await request.json().catch(() => null));
  if (!rule.valid) return NextResponse.json({ error: "ຂໍ້ມູນຄະແນນ/ວັນທີບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (rule.id) {
    await prisma.$executeRaw`UPDATE app_incentive_point_rule SET category_code=${rule.categoryCode}, brand_code=${rule.brandCode}, design_token=${rule.designToken}, size_token=${rule.sizeToken}, effective_from=${rule.effectiveFrom}::date, effective_to=${rule.effectiveTo}::date, points=${rule.points}, is_special=${rule.isSpecial}, updated_at=now() WHERE id=${BigInt(rule.id)}`;
  } else {
    await prisma.$executeRaw`INSERT INTO app_incentive_point_rule (category_code, brand_code, design_token, size_token, effective_from, effective_to, points, is_special) VALUES (${rule.categoryCode},${rule.brandCode},${rule.designToken},${rule.sizeToken},${rule.effectiveFrom}::date,${rule.effectiveTo}::date,${rule.points},${rule.isSpecial}) ON CONFLICT (category_code,brand_code,design_token,size_token,effective_from,effective_to,is_special) DO UPDATE SET points=EXCLUDED.points,updated_at=now()`;
  }
  return NextResponse.json(await listRows());
}

export async function DELETE(request: NextRequest) {
  if (!canManage(await getEmployeeFromRequest(request))) return NextResponse.json({ error: "ບໍ່ມີສິດລຶບຄະແນນໂບນັດ" }, { status: 403 });
  const id = String((await request.json().catch(() => null) as { id?: unknown } | null)?.id ?? "");
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "ID ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  await prisma.$executeRaw`DELETE FROM app_incentive_point_rule WHERE id=${BigInt(id)}`;
  return NextResponse.json(await listRows());
}
