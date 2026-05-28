import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

type ConfigRow = {
  id: bigint;
  scope: string;
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

type SalesAggBalance = {
  ic_code: string | null;
  qty: string | number | null;
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

// Build a balance map keyed differently depending on scope:
//   'warehouse'  → `${warehouse}\x1f${item}` → stock at that warehouse
//   'sales_agg'  → `*\x1f${item}`            → SUM across active sales warehouses
async function currentBalanceByKey(rows: ConfigRow[]) {
  if (rows.length === 0) return new Map<string, number>();
  const map = new Map<string, number>();

  const perWh = rows.filter((r) => r.scope === "warehouse");
  if (perWh.length > 0) {
    const codeList = [...new Set(perWh.map((row) => row.item_code))].join(",");
    const warehouseList = [...new Set(perWh.map((row) => row.warehouse_code))].join(",");
    if (codeList && warehouseList) {
      const balances = await prisma.$queryRaw<BalanceRow[]>`
        SELECT ic_code, warehouse, SUM(balance_qty) AS balance_qty
        FROM public.sml_ic_function_stock_balance_warehouse(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${codeList},
          ${warehouseList}
        )
        GROUP BY ic_code, warehouse
      `;
      for (const row of balances) {
        const item = row.ic_code?.trim();
        const warehouse = row.warehouse?.trim();
        if (!item || !warehouse) continue;
        map.set(`${warehouse}\x1f${item}`, toNumber(row.balance_qty));
      }
    }
  }

  const agg = rows.filter((r) => r.scope === "sales_agg");
  if (agg.length > 0) {
    const codeList = [...new Set(agg.map((row) => row.item_code))].join(",");
    if (codeList) {
      const balances = await prisma.$queryRaw<SalesAggBalance[]>`
        WITH sales_codes AS (
          SELECT warehouse_code FROM app_sales_warehouse WHERE is_active = TRUE
        )
        SELECT ic_code, SUM(balance_qty) AS qty
        FROM public.sml_ic_function_stock_balance_warehouse(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${codeList},
          (SELECT string_agg(warehouse_code, ',') FROM sales_codes)
        )
        WHERE warehouse IN (SELECT warehouse_code FROM sales_codes)
        GROUP BY ic_code
      `;
      for (const row of balances) {
        const item = row.ic_code?.trim();
        if (!item) continue;
        map.set(`*\x1f${item}`, toNumber(row.qty));
      }
    }
  }

  return map;
}

function toConfig(row: ConfigRow, currentStock: number) {
  const minQty = toNumber(row.min_qty);
  const targetQty = toNumber(row.target_qty);
  return {
    id: row.id.toString(),
    scope: row.scope,
    warehouseCode: row.scope === "sales_agg" ? null : row.warehouse_code,
    warehouseName:
      row.scope === "sales_agg"
        ? null
        : row.warehouse_name?.trim() || row.warehouse_code,
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
  // scope=warehouse|sales_agg|all (default: all)
  const scope = request.nextUrl.searchParams.get("scope")?.trim() ?? "all";
  const pattern = `%${q}%`;

  // Filters compose as SQL fragments so the four combinations of
  // (warehouse, q, scope) share a single query.
  const scopeFilter =
    scope === "warehouse"
      ? Prisma.sql`AND sm.scope = 'warehouse'`
      : scope === "sales_agg"
        ? Prisma.sql`AND sm.scope = 'sales_agg'`
        : Prisma.empty;

  // sales_agg rows have warehouse_code = '' (sentinel) and shouldn't match
  // a user's warehouse picker. We OR them in so they're always visible
  // when the user filters by a specific warehouse.
  const warehouseFilter = warehouse
    ? Prisma.sql`AND (sm.warehouse_code = ${warehouse} OR sm.scope = 'sales_agg')`
    : Prisma.empty;
  const searchFilter = q
    ? Prisma.sql`AND (
        sm.item_code ILIKE ${pattern}
        OR COALESCE(i.name_1, '') ILIKE ${pattern}
        OR COALESCE(i.name_eng_1, '') ILIKE ${pattern}
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<ConfigRow[]>`
    SELECT
      sm.id, sm.scope, sm.warehouse_code, wh.name_1 AS warehouse_name,
      sm.item_code, i.name_1 AS item_name, i.unit_standard_name AS unit_name,
      sm.min_qty, sm.target_qty, sm.daily_sales_qty, sm.cover_days,
      sm.safety_qty, sm.note, sm.updated_by, sm.updated_at
    FROM app_stock_minimum sm
    LEFT JOIN ic_warehouse wh ON wh.code = sm.warehouse_code
    LEFT JOIN ic_inventory i ON i.code = sm.item_code
    WHERE 1=1
      ${scopeFilter}
      ${warehouseFilter}
      ${searchFilter}
    ORDER BY sm.scope DESC, sm.updated_at DESC
    LIMIT 300
  `;

  const balanceMap = await currentBalanceByKey(rows);
  return NextResponse.json({
    canManage: canManage(employee),
    items: rows.map((row) =>
      toConfig(
        row,
        row.scope === "sales_agg"
          ? balanceMap.get(`*\x1f${row.item_code}`) ?? 0
          : balanceMap.get(`${row.warehouse_code}\x1f${row.item_code}`) ?? 0,
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
        scope?: unknown;
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

  const scopeRaw = typeof body?.scope === "string" ? body.scope.trim() : "warehouse";
  const scope = scopeRaw === "sales_agg" ? "sales_agg" : "warehouse";
  const warehouseCodeRaw =
    typeof body?.warehouseCode === "string" ? body.warehouseCode.trim() : "";
  // sales_agg uses '' as the sentinel warehouse_code so the existing
  // UNIQUE(warehouse_code, item_code) constraint covers both scopes.
  const warehouseCode = scope === "sales_agg" ? "" : warehouseCodeRaw;
  const itemCode = typeof body?.itemCode === "string" ? body.itemCode.trim() : "";

  if (!itemCode) {
    return NextResponse.json({ error: "itemCode ຈຳເປັນ" }, { status: 400 });
  }
  if (scope === "warehouse" && !warehouseCode) {
    return NextResponse.json(
      { error: "warehouseCode ຈຳເປັນສຳລັບ scope=warehouse" },
      { status: 400 },
    );
  }

  // Block creating a per-warehouse rule in a sales warehouse — those should
  // be managed via the sales_agg rule instead.
  if (scope === "warehouse" && warehouseCode) {
    const hit = await prisma.$queryRaw<Array<{ warehouse_code: string }>>`
      SELECT warehouse_code FROM app_sales_warehouse
      WHERE warehouse_code = ${warehouseCode} AND is_active = TRUE
      LIMIT 1
    `;
    if (hit.length > 0) {
      return NextResponse.json(
        {
          error:
            "ສາງນີ້ເປັນສາງຂາຍ — ໃຊ້ scope = sales_agg (1 rule ລວມສຳລັບທຸກສາງຂາຍ)",
        },
        { status: 400 },
      );
    }
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
      warehouse_code, item_code, scope, min_qty, target_qty, daily_sales_qty,
      cover_days, safety_qty, note, updated_by, updated_at
    )
    VALUES (
      ${warehouseCode}, ${itemCode}, ${scope}, ${minQty}, ${targetQty},
      ${dailySalesQty}, ${coverDays}, ${safetyQty}, ${note}, ${updatedBy}, now()
    )
    ON CONFLICT (warehouse_code, item_code)
    DO UPDATE SET
      scope = EXCLUDED.scope,
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

  const scopeRaw = request.nextUrl.searchParams.get("scope")?.trim() ?? "warehouse";
  const scope = scopeRaw === "sales_agg" ? "sales_agg" : "warehouse";
  const warehouseCodeRaw =
    request.nextUrl.searchParams.get("warehouseCode")?.trim() ?? "";
  const warehouseCode = scope === "sales_agg" ? "" : warehouseCodeRaw;
  const itemCode = request.nextUrl.searchParams.get("itemCode")?.trim();
  if (!itemCode) {
    return NextResponse.json({ error: "itemCode ຈຳເປັນ" }, { status: 400 });
  }
  if (scope === "warehouse" && !warehouseCode) {
    return NextResponse.json(
      { error: "warehouseCode ຈຳເປັນ" },
      { status: 400 },
    );
  }

  await prisma.$executeRaw`
    DELETE FROM app_stock_minimum
    WHERE warehouse_code = ${warehouseCode}
      AND item_code = ${itemCode}
      AND scope = ${scope}
  `;

  return NextResponse.json({ ok: true });
}
