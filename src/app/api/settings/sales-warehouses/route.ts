import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

type WarehouseRow = {
  code: string | null;
  name_1: string | null;
  branch_code: string | null;
  od_code: string | null;
  is_sales: boolean | null;
  note: string | null;
};

function canManage(employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<WarehouseRow[]>`
    SELECT
      wh.code,
      wh.name_1,
      wh.branch_code,
      wh.od_code,
      COALESCE(sw.is_active, FALSE) AS is_sales,
      sw.note
    FROM ic_warehouse wh
    LEFT JOIN app_sales_warehouse sw ON sw.warehouse_code = wh.code
    WHERE wh.status = 1
      AND wh.code IS NOT NULL
    ORDER BY wh.code
  `;
  const activeCodes = new Set(await getConfiguredSalesWarehouses());

  return NextResponse.json({
    canManage: canManage(employee),
    items: rows
      .filter((row) => row.code)
      .map((row) => ({
        code: row.code,
        name: row.name_1?.trim() || row.code,
        branchCode: row.branch_code,
        odCode: row.od_code,
        isSalesWarehouse: row.is_sales === true || activeCodes.has(row.code as string),
        note: row.note,
      })),
  });
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManage(employee)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດແກ້ໄຂການຕັ້ງຄ່າສາງຂາຍ" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { warehouseCodes?: unknown }
    | null;
  const warehouseCodes = Array.isArray(body?.warehouseCodes)
    ? (body!.warehouseCodes as unknown[])
        .filter((code): code is string => typeof code === "string")
        .map((code) => code.trim())
        .filter(Boolean)
    : [];

  const uniqueCodes = [...new Set(warehouseCodes)];
  const updatedBy = employee.employeeCode ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE app_sales_warehouse
      SET is_active = FALSE, updated_by = ${updatedBy}, updated_at = now()
    `;
    for (const code of uniqueCodes) {
      await tx.$executeRaw`
        INSERT INTO app_sales_warehouse (
          warehouse_code, is_active, updated_by, updated_at
        )
        VALUES (${code}, TRUE, ${updatedBy}, now())
        ON CONFLICT (warehouse_code)
        DO UPDATE SET
          is_active = TRUE,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
    }
  });

  return GET(request);
}
