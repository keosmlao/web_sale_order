import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Monthly sales-target pivot (odg_retail_target_employee): every ACTIVE
// front-store SELLER (position 13 — bonuses/targets apply to sellers only)
// gets an editable CE / AC target per month.

const SELLER_DEPTS = ["204", "205", "207"];
const GROUPS = ["CE", "AC"] as const;

function parsePeriod(url: URL): { year: number; month: number } | null {
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const period = parsePeriod(new URL(request.url));
  if (!period) return NextResponse.json({ error: "year/month ບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const [employees, targets] = await Promise.all([
    prisma.$queryRaw<Array<{
      employee_code: string;
      fullname_lo: string | null;
      nickname: string | null;
      department_code: string | null;
    }>>`
      SELECT employee_code, fullname_lo, nickname, department_code
      FROM odg_employee
      WHERE position_code = '13'
        AND department_code = ANY(${SELLER_DEPTS})
        AND COALESCE(employment_status, 'ACTIVE') = 'ACTIVE'
      ORDER BY department_code, employee_code
    `,
    prisma.$queryRaw<Array<{
      emp_code: string;
      product_group: string;
      target: string | number | null;
    }>>`
      SELECT DISTINCT ON (emp_code, product_group) emp_code, product_group, target
      FROM odg_retail_target_employee
      WHERE year = ${period.year.toString()}
        AND LPAD(month, 2, '0') = ${period.month.toString().padStart(2, "0")}
      ORDER BY emp_code, product_group, roworder DESC
    `,
  ]);

  return NextResponse.json({
    year: period.year,
    month: period.month,
    employees: employees.map((e) => ({
      code: e.employee_code,
      name: e.fullname_lo?.trim() || e.nickname?.trim() || e.employee_code,
      dept: e.department_code ?? "",
    })),
    targets: targets.map((t) => ({
      employeeCode: t.emp_code?.trim(),
      groupCode: t.product_group?.trim(),
      target: Number(t.target ?? 0),
    })),
  });
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = roleFromEmployee(employee);
  if (role !== "manager" && role !== "head") {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ Target" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    year?: number;
    month?: number;
    entries?: Array<{ employeeCode?: string; groupCode?: string; target?: number | null }>;
  } | null;
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const entries = (body?.entries ?? []).filter(
    (e) =>
      typeof e.employeeCode === "string" && e.employeeCode.trim() &&
      GROUPS.includes((e.groupCode ?? "") as (typeof GROUPS)[number]) &&
      (e.target === null || (Number.isFinite(Number(e.target)) && Number(e.target) >= 0)),
  );
  if (entries.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີຂໍ້ມູນທີ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const mm = month.toString().padStart(2, "0");
  // Replace-style upsert per (employee, group, month): clears duplicates from
  // repeated legacy inserts, then writes the new value (blank/0 = no target).
  for (const e of entries) {
    const code = e.employeeCode!.trim();
    const group = e.groupCode!;
    await prisma.$executeRaw`
      DELETE FROM odg_retail_target_employee
      WHERE emp_code = ${code}
        AND year = ${year.toString()}
        AND LPAD(month, 2, '0') = ${mm}
        AND product_group = ${group}
    `;
    const target = Number(e.target ?? 0);
    if (target > 0) {
      await prisma.$executeRaw`
        INSERT INTO odg_retail_target_employee (emp_code, target, year, month, product_group)
        VALUES (${code}, ${target}, ${year.toString()}, ${mm}, ${group})
      `;
    }
  }
  return NextResponse.json({ ok: true, saved: entries.length });
}
