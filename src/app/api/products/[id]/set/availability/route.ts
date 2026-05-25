import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  getConfiguredSalesWarehouses,
  STOCK_BALANCE_AS_OF_DATE,
} from "@/lib/inventory-config";

type RouteContext = { params: Promise<{ id: string }> };

type SetDetailRow = {
  line_number: number | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string | number | null;
};

type WarehouseRow = {
  code: string;
  name_1: string | null;
};

type BalanceRow = {
  ic_code: string | null;
  warehouse: string | null;
  balance_qty: string | null;
};

// Per-set, per-warehouse availability check for the POS set-build modal.
//
// Given a set product code, this:
//   1. Reads the set's components from ic_inventory_set_detail
//   2. For every active warehouse (ic_warehouse), reads each component's
//      summed balance from sml_ic_function_stock_balance_warehouse
//   3. Classifies each warehouse as:
//        complete   — all components meet requiredPerSet → can build ≥1 set
//        incomplete — some component has stock but at least one is short
//        none       — every component is zero in that warehouse
//   4. Returns the component definitions + per-warehouse breakdown so the
//      cashier can see exactly which warehouse has the complete set and
//      which component is missing where.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const code = decodeURIComponent(id).trim();
  if (!code) {
    return NextResponse.json({ error: "Missing product code" }, { status: 400 });
  }

  const details = await prisma.$queryRaw<SetDetailRow[]>`
    SELECT
      d.line_number,
      d.ic_code AS item_code,
      i.name_1 AS item_name,
      COALESCE(NULLIF(d.unit_code, ''), i.unit_standard_name) AS unit_code,
      d.qty
    FROM ic_inventory_set_detail d
    LEFT JOIN ic_inventory i ON i.code = d.ic_code
    WHERE d.ic_set_code = ${code}
      AND COALESCE(d.status, 0) <> 1
    ORDER BY d.line_number NULLS LAST, d.roworder
  `;

  const components = details.map((row) => ({
    lineNumber: row.line_number ?? 0,
    itemCode: row.item_code,
    itemName: row.item_name ?? row.item_code,
    unitCode: row.unit_code,
    requiredPerSet: Number(row.qty ?? 0),
  }));

  if (components.length === 0) {
    return NextResponse.json({
      productCode: code,
      components: [],
      warehouses: [],
    });
  }

  const salesWarehouses = await getConfiguredSalesWarehouses();
  const salesWarehouseList = salesWarehouses.join(",");
  const warehouses = salesWarehouseList
    ? await prisma.$queryRaw<WarehouseRow[]>`
        SELECT code, name_1
        FROM ic_warehouse
        WHERE status = 1
          AND code IS NOT NULL
          AND code = ANY(string_to_array(${salesWarehouseList}, ','))
        ORDER BY code
      `
    : await prisma.$queryRaw<WarehouseRow[]>`
    SELECT code, name_1
    FROM ic_warehouse
    WHERE status = 1
      AND code IS NOT NULL
    ORDER BY code
  `;

  const codeList = components.map((c) => c.itemCode).join(",");
  const warehouseList = warehouses.map((w) => w.code).join(",");

  const balances = warehouseList
    ? await prisma.$queryRaw<BalanceRow[]>`
        SELECT
          ic_code,
          warehouse,
          SUM(balance_qty)::text AS balance_qty
        FROM public.sml_ic_function_stock_balance_warehouse(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${codeList},
          ${warehouseList}
        )
        GROUP BY ic_code, warehouse
      `
    : [];

  // (warehouse → (ic_code → balance))
  const byWh = new Map<string, Map<string, number>>();
  for (const row of balances) {
    const wh = row.warehouse?.trim();
    const ic = row.ic_code?.trim();
    if (!wh || !ic) continue;
    const inner = byWh.get(wh) ?? new Map<string, number>();
    inner.set(ic, Number(row.balance_qty ?? 0));
    byWh.set(wh, inner);
  }

  const warehouseAvailability = warehouses.map((w) => {
    const wh = w.code;
    const inner = byWh.get(wh) ?? new Map<string, number>();
    let buildable: number | null = null;
    let anyStock = false;
    let allMet = true;
    const compRows = components.map((c) => {
      const balance = inner.get(c.itemCode) ?? 0;
      if (balance > 0) anyStock = true;
      const compBuildable =
        c.requiredPerSet > 0 ? Math.floor(balance / c.requiredPerSet) : 0;
      const sufficient = balance >= c.requiredPerSet && c.requiredPerSet > 0;
      if (!sufficient) allMet = false;
      buildable =
        buildable === null ? compBuildable : Math.min(buildable, compBuildable);
      return {
        itemCode: c.itemCode,
        balanceQty: balance,
        sufficient,
        shortBy: sufficient ? 0 : Math.max(0, c.requiredPerSet - balance),
      };
    });
    const buildableSets = Math.max(0, buildable ?? 0);
    const status: "complete" | "incomplete" | "none" =
      buildableSets >= 1 && allMet
        ? "complete"
        : anyStock
          ? "incomplete"
          : "none";
    return {
      warehouseCode: wh,
      warehouseName: w.name_1?.trim() || wh,
      status,
      buildableSets,
      components: compRows,
    };
  });

  // Drop "none" warehouses — they have zero stock for every component, so
  // showing them in the picker is just noise. Sort the rest: complete first
  // (by buildable count desc), then incomplete.
  const visible = warehouseAvailability.filter((w) => w.status !== "none");
  visible.sort((a, b) => {
    const rank = (s: typeof a.status) => (s === "complete" ? 0 : 1);
    const rA = rank(a.status);
    const rB = rank(b.status);
    if (rA !== rB) return rA - rB;
    if (a.status === "complete") return b.buildableSets - a.buildableSets;
    return a.warehouseCode.localeCompare(b.warehouseCode);
  });

  return NextResponse.json({
    productCode: code,
    components,
    warehouses: visible,
  });
}
