import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import EmployeesClient from "./EmployeesClient";

export const dynamic = "force-dynamic";

type SearchParams = {
  page?: string | string[];
  pageSize?: string | string[];
  q?: string | string[];
  dept?: string | string[];
  status?: string | string[];
};

function pickString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function pickPositiveInt(v: string | string[] | undefined, fallback: number, max: number): number {
  const raw = pickString(v);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireEmployee();
  const sp = await searchParams;

  const page = pickPositiveInt(sp.page, 1, 1_000_000);
  const pageSize = pickPositiveInt(sp.pageSize, 50, 500);
  const q = pickString(sp.q).trim();
  const deptFilter = pickString(sp.dept).trim();
  const statusFilter = pickString(sp.status).trim();
  const offset = (page - 1) * pageSize;

  const qLike = `%${q.toLowerCase()}%`;
  const search = q
    ? Prisma.sql`AND (
 LOWER(COALESCE(e.employee_code,'')) LIKE ${qLike}
 OR LOWER(COALESCE(e.fullname_lo,'')) LIKE ${qLike}
 OR LOWER(COALESCE(e.nickname,'')) LIKE ${qLike}
 OR LOWER(COALESCE(e.fullname_en,'')) LIKE ${qLike}
 OR LOWER(COALESCE(e.line_id,'')) LIKE ${qLike}
 )`
    : Prisma.empty;

  const [countRows, rows, statusFacets, deptRows, availableRows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>`
 SELECT COUNT(*)::bigint AS n
 FROM app_employee_access a
 JOIN odg_employee e ON e.employee_code = a.employee_code
 WHERE 1 = 1
 ${deptFilter ? Prisma.sql`AND e.department_code = ${deptFilter}` : Prisma.empty}
 ${statusFilter
        ? statusFilter === "INACTIVE"
          ? Prisma.sql`AND a.is_active = false`
          : Prisma.sql`AND a.is_active = true`
        : Prisma.empty
      }
 ${search}
 `,
    prisma.$queryRaw<
      Array<{
        employee_id: number;
        employee_code: string | null;
        title_lo: string | null;
        fullname_lo: string | null;
        nickname: string | null;
        title_en: string | null;
        fullname_en: string | null;
        position_code: string | null;
        division_code: string | null;
        department_code: string | null;
        unit_code: string | null;
        hire_date: Date | null;
        employment_status: string | null;
        line_id: string | null;
        app_role: string | null;
        access_position_code: string | null;
        is_app_active: boolean;
        has_password: boolean;
      }>
    >`
 SELECT
 e.employee_id,
 e.employee_code,
 e.title_lo,
 e.fullname_lo,
 e.nickname,
 e.title_en,
 e.fullname_en,
 e.position_code,
 e.division_code,
 e.department_code,
 e.unit_code,
 e.hire_date,
 e.employment_status,
 e.line_id,
 a.app_role,
 a.position_code AS access_position_code,
 a.is_active AS is_app_active,
 (e.password IS NOT NULL AND e.password <>'') AS has_password
 FROM app_employee_access a
 JOIN odg_employee e ON e.employee_code = a.employee_code
 WHERE 1 = 1
 ${deptFilter ? Prisma.sql`AND e.department_code = ${deptFilter}` : Prisma.empty}
 ${statusFilter
        ? statusFilter === "INACTIVE"
          ? Prisma.sql`AND a.is_active = false`
          : Prisma.sql`AND a.is_active = true`
        : Prisma.empty
      }
 ${search}
 ORDER BY e.department_code, e.fullname_lo NULLS LAST, e.employee_code
 LIMIT ${pageSize} OFFSET ${offset}
 `,
    // Status facets (within current dept filter, no search) so the badges always show real counts.
    prisma.$queryRaw<Array<{ status: string | null; n: bigint }>>`
 SELECT
 CASE WHEN a.is_active THEN'ACTIVE' ELSE'INACTIVE' END AS status,
 COUNT(*)::bigint AS n
 FROM app_employee_access a
 JOIN odg_employee e ON e.employee_code = a.employee_code
 WHERE 1 = 1 ${deptFilter ? Prisma.sql`AND e.department_code = ${deptFilter}` : Prisma.empty}
 GROUP BY 1
 `,
    // All active departments — used to populate the dept filter dropdown.
    // Pulled from odg_department so the codes always match the data instead of
    // a hard-coded list that drifts.
    prisma.$queryRaw<Array<{ department_code: string; department_name_lo: string | null }>>`
 SELECT department_code, department_name_lo
 FROM odg_department
 WHERE is_active = true
 AND department_code IS NOT NULL
 ORDER BY department_code
 `,
    // Employees in odg_employee not yet linked in app_employee_access — used
    // to populate the "add user" picker so admins choose from a list instead
    // of typing employee_code by hand.
    prisma.$queryRaw<
      Array<{
        employee_code: string;
        fullname_lo: string | null;
        fullname_en: string | null;
        nickname: string | null;
        department_code: string | null;
        position_code: string | null;
      }>
    >`
 SELECT e.employee_code,
 e.fullname_lo,
 e.fullname_en,
 e.nickname,
 e.department_code,
 e.position_code
 FROM odg_employee e
 LEFT JOIN app_employee_access a ON a.employee_code = e.employee_code
 WHERE e.employee_code IS NOT NULL
 AND a.employee_code IS NULL
 ORDER BY e.department_code NULLS LAST, e.fullname_lo NULLS LAST, e.employee_code
 `,
  ]);

  const total = Number(countRows[0]?.n ?? 0);

  const employees = rows.map((r) => {
    const positionCode = r.access_position_code?.trim() || r.position_code?.trim() || null;
    const override = r.app_role?.trim() || null;
    return {
      employeeCode: r.employee_code?.trim() || "",
      titleLo: r.title_lo?.trim() || null,
      fullnameLo: r.fullname_lo?.trim() || null,
      nickname: r.nickname?.trim() || null,
      titleEn: r.title_en?.trim() || null,
      fullnameEn: r.fullname_en?.trim() || null,
      positionCode,
      divisionCode: r.division_code?.trim() || null,
      departmentCode: r.department_code?.trim() || null,
      unitCode: r.unit_code?.trim() || null,
      hireDate: r.hire_date ? r.hire_date.toISOString().slice(0, 10) : null,
      employmentStatus: r.is_app_active ? "ACTIVE" : "INACTIVE",
      lineId: r.line_id?.trim() || null,
      appRole: roleFromEmployee({ appRole: override, positionCode }),
      roleOverride: null,
      hasPassword: !!r.has_password,
    };
  });

  let activeCount = 0;
  let inactiveCount = 0;
  for (const f of statusFacets) {
    if (f.status === "ACTIVE") activeCount = Number(f.n ?? 0);
    else inactiveCount = Number(f.n ?? 0);
  }

  const depts = deptRows.map((r) => ({
    code: r.department_code,
    name: r.department_name_lo?.trim() || r.department_code,
  }));

  const availableEmployees = availableRows.map((r) => ({
    code: r.employee_code.trim(),
    fullnameLo: r.fullname_lo?.trim() || null,
    fullnameEn: r.fullname_en?.trim() || null,
    nickname: r.nickname?.trim() || null,
    departmentCode: r.department_code?.trim() || null,
    positionCode: r.position_code?.trim() || null,
  }));

  return (
    <EmployeesClient
      employees={employees}
      depts={depts}
      availableEmployees={availableEmployees}
      total={total}
      activeCount={activeCount}
      inactiveCount={inactiveCount}
      page={page}
      pageSize={pageSize}
      query={q}
      dept={deptFilter}
      status={statusFilter}
      currentEmployeeCode={me.employeeCode ?? ""}
      currentUserRole={roleFromEmployee(me)}
    />
  );
}
