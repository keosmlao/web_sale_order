import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

type ConfigRow = {
  id: bigint;
  warehouse_code: string;
  warehouse_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_name: string | null;
  min_qty: string | number | null;
  target_qty: string | number | null;
  daily_sales_qty: string | number | null;
  cover_days: string | number | null;
  safety_qty: string | number | null;
  note: string | null;
  updated_by: string | null;
  updated_at: Date;
};

type BalanceRow = {
  ic_code: string | null;
  warehouse: string | null;
  balance_qty: string | number | null;
};

function canManage(employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePositiveNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function currentBalanceByKey(rows: ConfigRow[]) {
  if (rows.length === 0) return new Map<string, number>();
  const codeList = [...new Set(rows.map((row) => row.item_code))].join(",");
  const warehouseList = [...new Set(rows.map((row) => row.warehouse_code))].join(",");
  if (!codeList || !warehouseList) return new Map<string, number>();
  const balances = await prisma.$queryRaw<BalanceRow[]>`
    SELECT ic_code, warehouse, SUM(balance_qty) AS balance_qty
    FROM public.sml_ic_function_stock_balance_warehouse(
      ${STOCK_BALANCE_AS_OF_DATE}::date,
      ${codeList},
      ${warehouseList}
    )
    GROUP BY ic_code, warehouse
  `;
  const map = new Map<string, number>();
  for (const row of balances) {
    const item = row.ic_code?.trim();
    const warehouse = row.warehouse?.trim();
    if (!item || !warehouse) continue;
    map.set(`${warehouse}\x1f${item}`, toNumber(row.balance_qty));
  }
  return map;
}

function toConfig(row: ConfigRow, currentStock: number) {
  const minQty = toNumber(row.min_qty);
  const targetQty = toNumber(row.target_qty);
  return {
    id: row.id.toString(),
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name?.trim() || row.warehouse_code,
    itemCode: row.item_code,
    itemName: row.item_name?.trim() || row.item_code,
    unitName: row.unit_name?.trim() || null,
    minQty,
    targetQty,
    dailySalesQty: toNumber(row.daily_sales_qty),
    coverDays: toNumber(row.cover_days),
    safetyQty: toNumber(row.safety_qty),
    currentStock,
    shortageQty: Math.max(0, minQty - currentStock),
    status:
      currentStock <= 0
        ? "out"
        : minQty > 0 && currentStock < minQty
          ? "low"
          : targetQty > 0 && currentStock < targetQty
            ? "below_target"
            : "ok",
    note: row.note?.trim() || null,
    updatedBy: row.updated_by?.trim() || null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const warehouse = request.nextUrl.searchParams.get("warehouse")?.trim() ?? "";
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const pattern = `%${q}%`;

  const rows =
    warehouse && q
      ? await prisma.$queryRaw<ConfigRow[]>`
          SELECT
            sm.id, sm.warehouse_code, wh.name_1 AS warehouse_name,
            sm.item_code, i.name_1 AS item_name, i.unit_standard_name AS unit_name,
            sm.min_qty, sm.target_qty, sm.daily_sales_qty, sm.cover_days,
            sm.safety_qty, sm.note, sm.updated_by, sm.updated_at
          FROM app_stock_minimum sm
          LEFT JOIN ic_warehouse wh ON wh.code = sm.warehouse_code
          LEFT JOIN ic_inventory i ON i.code = sm.item_code
          WHERE sm.warehouse_code = ${warehouse}
            AND (
              sm.item_code ILIKE ${pattern}
              OR COALESCE(i.name_1, '') ILIKE ${pattern}
              OR COALESCE(i.name_eng_1, '') ILIKE ${pattern}
            )
          ORDER BY sm.updated_at DESC
          LIMIT 200
        `
      : warehouse
        ? await prisma.$queryRaw<ConfigRow[]>`
            SELECT
              sm.id, sm.warehouse_code, wh.name_1 AS warehouse_name,
              sm.item_code, i.name_1 AS item_name, i.unit_standard_name AS unit_name,
              sm.min_qty, sm.target_qty, sm.daily_sales_qty, sm.cover_days,
              sm.safety_qty, sm.note, sm.updated_by, sm.updated_at
            FROM app_stock_minimum sm
            LEFT JOIN ic_warehouse wh ON wh.code = sm.warehouse_code
            LEFT JOIN ic_inventory i ON i.code = sm.item_code
            WHERE sm.warehouse_code = ${warehouse}
            ORDER BY sm.updated_at DESC
            LIMIT 200
          `
        : q
          ? await prisma.$queryRaw<ConfigRow[]>`
              SELECT
                sm.id, sm.warehouse_code, wh.name_1 AS warehouse_name,
                sm.item_code, i.name_1 AS item_name, i.unit_standard_name AS unit_name,
                sm.min_qty, sm.target_qty, sm.daily_sales_qty, sm.cover_days,
                sm.safety_qty, sm.note, sm.updated_by, sm.updated_at
              FROM app_stock_minimum sm
              LEFT JOIN ic_warehouse wh ON wh.code = sm.warehouse_code
              LEFT JOIN ic_inventory i ON i.code = sm.item_code
              WHERE sm.item_code ILIKE ${pattern}
                OR COALESCE(i.name_1, '') ILIKE ${pattern}
                OR COALESCE(i.name_eng_1, '') ILIKE ${pattern}
              ORDER BY sm.updated_at DESC
              LIMIT 200
            `
          : await prisma.$queryRaw<ConfigRow[]>`
              SELECT
                sm.id, sm.warehouse_code, wh.name_1 AS warehouse_name,
                sm.item_code, i.name_1 AS item_name, i.unit_standard_name AS unit_name,
                sm.min_qty, sm.target_qty, sm.daily_sales_qty, sm.cover_days,
                sm.safety_qty, sm.note, sm.updated_by, sm.updated_at
              FROM app_stock_minimum sm
              LEFT JOIN ic_warehouse wh ON wh.code = sm.warehouse_code
              LEFT JOIN ic_inventory i ON i.code = sm.item_code
              ORDER BY sm.updated_at DESC
              LIMIT 200
            `;

  const balanceMap = await currentBalanceByKey(rows);
  return NextResponse.json({
    canManage: canManage(employee),
    items: rows.map((row) =>
      toConfig(
        row,
        balanceMap.get(`${row.warehouse_code}\x1f${row.item_code}`) ?? 0,
      ),
    ),
  });
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManage(employee)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດແກ້ໄຂ minimum stock" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        warehouseCode?: unknown;
        itemCode?: unknown;
        minQty?: unknown;
        targetQty?: unknown;
        dailySalesQty?: unknown;
        coverDays?: unknown;
        safetyQty?: unknown;
        note?: unknown;
      }
    | null;

  const warehouseCode =
    typeof body?.warehouseCode === "string" ? body.warehouseCode.trim() : "";
  const itemCode = typeof body?.itemCode === "string" ? body.itemCode.trim() : "";
  if (!warehouseCode || !itemCode) {
    return NextResponse.json(
      { error: "warehouseCode ແລະ itemCode ຈຳເປັນຕ້ອງມີ" },
      { status: 400 },
    );
  }

  const dailySalesQty = parsePositiveNumber(body?.dailySalesQty);
  const coverDays = parsePositiveNumber(body?.coverDays);
  const safetyQty = parsePositiveNumber(body?.safetyQty);
  const calculatedMin = dailySalesQty * coverDays + safetyQty;
  const minQty = parsePositiveNumber(body?.minQty, calculatedMin);
  const targetQty = parsePositiveNumber(body?.targetQty, minQty);
  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;
  const updatedBy = employee.employeeCode ?? null;

  await prisma.$executeRaw`
    INSERT INTO app_stock_minimum (
      warehouse_code, item_code, min_qty, target_qty, daily_sales_qty,
      cover_days, safety_qty, note, updated_by, updated_at
    )
    VALUES (
      ${warehouseCode}, ${itemCode}, ${minQty}, ${targetQty}, ${dailySalesQty},
      ${coverDays}, ${safetyQty}, ${note}, ${updatedBy}, now()
    )
    ON CONFLICT (warehouse_code, item_code)
    DO UPDATE SET
      min_qty = EXCLUDED.min_qty,
      target_qty = EXCLUDED.target_qty,
      daily_sales_qty = EXCLUDED.daily_sales_qty,
      cover_days = EXCLUDED.cover_days,
      safety_qty = EXCLUDED.safety_qty,
      note = EXCLUDED.note,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManage(employee)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດແກ້ໄຂ minimum stock" },
      { status: 403 },
    );
  }

  const warehouseCode = request.nextUrl.searchParams.get("warehouseCode")?.trim();
  const itemCode = request.nextUrl.searchParams.get("itemCode")?.trim();
  if (!warehouseCode || !itemCode) {
    return NextResponse.json(
      { error: "warehouseCode ແລະ itemCode ຈຳເປັນຕ້ອງມີ" },
      { status: 400 },
    );
  }

  await prisma.$executeRaw`
    DELETE FROM app_stock_minimum
    WHERE warehouse_code = ${warehouseCode}
      AND item_code = ${itemCode}
  `;

  return NextResponse.json({ ok: true });
}
