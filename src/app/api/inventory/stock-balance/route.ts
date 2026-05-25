import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

type BaseRow = {
  ic_code: string | null;
  ic_name: string | null;
  balance_qty: string | null;
  ic_unit_code: string | null;
  average_cost: string | null;
  average_cost_end: string | null;
  balance_amount: string | null;
};

type WarehouseRow = BaseRow & {
  warehouse: string | null;
};

type LocationRow = BaseRow & {
  warehouse: string | null;
  warehouse_name: string | null;
  location: string | null;
  location_name: string | null;
};

function toBalance(row: BaseRow, locations: LocationRow[] = []) {
  return {
    code: row.ic_code,
    name: row.ic_name,
    balanceQty: row.balance_qty ? Number(row.balance_qty) : 0,
    unitCode: row.ic_unit_code,
    averageCost: row.average_cost ? Number(row.average_cost) : 0,
    averageCostEnd: row.average_cost_end ? Number(row.average_cost_end) : 0,
    balanceAmount: row.balance_amount ? Number(row.balance_amount) : 0,
    locations: locations.map((loc) => ({
      code: loc.ic_code,
      name: loc.ic_name,
      warehouse: loc.warehouse,
      warehouseName: loc.warehouse_name,
      location: loc.location,
      locationName: loc.location_name,
      balanceQty: loc.balance_qty ? Number(loc.balance_qty) : 0,
      unitCode: loc.ic_unit_code,
      averageCost: loc.average_cost ? Number(loc.average_cost) : 0,
      averageCostEnd: loc.average_cost_end ? Number(loc.average_cost_end) : 0,
      balanceAmount: loc.balance_amount ? Number(loc.balance_amount) : 0,
    })),
  };
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { codes?: unknown; warehouses?: unknown }
    | null;

  const codes = Array.isArray(body?.codes)
    ? (body!.codes as unknown[])
        .filter((c): c is string => typeof c === "string" && c.trim() !== "")
        .map((c) => c.trim())
    : [];

  const warehouses = Array.isArray(body?.warehouses)
    ? (body!.warehouses as unknown[])
        .filter((w): w is string => typeof w === "string" && w.trim() !== "")
        .map((w) => w.trim())
    : [];

  if (codes.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const codeList = codes.join(",");

  if (warehouses.length === 0) {
    // Company-wide: sum across all warehouses (function returns one row per code).
    const [rows, locationRows] = await Promise.all([
      prisma.$queryRaw<BaseRow[]>`
        SELECT
          ic_code,
          ic_name,
          balance_qty,
          ic_unit_code,
          average_cost,
          average_cost_end,
          balance_amount
        FROM public.sml_ic_function_stock_balance(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${codeList}
        )
      `,
      prisma.$queryRaw<LocationRow[]>`
        SELECT
          b.ic_code,
          b.ic_name,
          b.warehouse,
          wh.name_1 AS warehouse_name,
          b.location,
          sh.name_1 AS location_name,
          b.balance_qty,
          b.ic_unit_code,
          b.average_cost,
          b.average_cost_end,
          b.balance_amount
        FROM public.sml_ic_function_stock_balance_warehouse_location(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${codeList},
          '',
          ''
        ) b
        LEFT JOIN ic_warehouse wh ON wh.code = b.warehouse
        LEFT JOIN ic_shelf sh ON sh.whcode = b.warehouse AND sh.code = b.location
        WHERE COALESCE(b.balance_qty, 0) <> 0
        ORDER BY b.ic_code, b.warehouse, b.location
      `,
    ]);
    const locationsByCode = new Map<string, LocationRow[]>();
    for (const row of locationRows) {
      if (!row.ic_code) continue;
      const list = locationsByCode.get(row.ic_code) ?? [];
      list.push(row);
      locationsByCode.set(row.ic_code, list);
    }
    return NextResponse.json({
      scope: "company",
      warehouses: [],
      items: rows.map((r) => toBalance(r, r.ic_code ? locationsByCode.get(r.ic_code) : [])),
    });
  }

  // Warehouse-scoped: sum balance across the requested warehouses per code and include locations.
  //
  // "location" in this DB is actually a stock *condition* row from ic_shelf
  // (ສະພາບດີ / ສະພາບຕຳນິ / ສະພາບເພ / ສາງລ໋ອກໜ້າຮ້ານ). The picker needs to
  // show every condition for the warehouse, not just the ones the live
  // function returns — otherwise the cashier can't decide which condition
  // to sell from. We LEFT JOIN ic_shelf → live balance so empty conditions
  // still render (with balance 0) and the salesperson sees the full picture.
  const warehouseList = warehouses.join(",");
  const [rows, locationRows] = await Promise.all([
    prisma.$queryRaw<WarehouseRow[]>`
      SELECT
        ic_code,
        MAX(ic_name) AS ic_name,
        SUM(balance_qty) AS balance_qty,
        MAX(ic_unit_code) AS ic_unit_code,
        AVG(NULLIF(average_cost, 0)) AS average_cost,
        AVG(NULLIF(average_cost_end, 0)) AS average_cost_end,
        SUM(balance_amount) AS balance_amount,
        NULL::varchar AS warehouse
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        ${codeList},
        ${warehouseList}
      )
      GROUP BY ic_code
    `,
    prisma.$queryRaw<LocationRow[]>`
      WITH shelves AS (
        SELECT sh.code AS location, sh.name_1 AS location_name,
               sh.whcode AS warehouse, wh.name_1 AS warehouse_name
        FROM ic_shelf sh
        LEFT JOIN ic_warehouse wh ON wh.code = sh.whcode
        WHERE sh.whcode = ANY(string_to_array(${warehouseList}, ','))
      ),
      balances AS (
        SELECT
          b.ic_code,
          b.ic_name,
          b.warehouse,
          b.location,
          b.balance_qty,
          b.ic_unit_code,
          b.average_cost,
          b.average_cost_end,
          b.balance_amount
        FROM public.sml_ic_function_stock_balance_warehouse_location(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${codeList},
          ${warehouseList},
          ''
        ) b
      ),
      codes AS (
        SELECT i.code AS ic_code, i.name_1 AS ic_name, i.unit_standard_name AS ic_unit_code
        FROM ic_inventory i
        WHERE i.code = ANY(string_to_array(${codeList}, ','))
      )
      SELECT
        c.ic_code,
        c.ic_name,
        s.warehouse,
        s.warehouse_name,
        s.location,
        s.location_name,
        COALESCE(b.balance_qty, 0) AS balance_qty,
        COALESCE(b.ic_unit_code, c.ic_unit_code) AS ic_unit_code,
        b.average_cost,
        b.average_cost_end,
        b.balance_amount
      FROM codes c
      CROSS JOIN shelves s
      LEFT JOIN balances b
        ON b.ic_code = c.ic_code
        AND b.warehouse = s.warehouse
        AND b.location = s.location
      ORDER BY c.ic_code, s.warehouse, s.location
    `,
  ]);
  const locationsByCode = new Map<string, LocationRow[]>();
  for (const row of locationRows) {
    if (!row.ic_code) continue;
    const list = locationsByCode.get(row.ic_code) ?? [];
    list.push(row);
    locationsByCode.set(row.ic_code, list);
  }

  return NextResponse.json({
    scope: "warehouses",
    warehouses,
    items: rows.map((r) => toBalance(r, r.ic_code ? locationsByCode.get(r.ic_code) : [])),
  });
}
