import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  canApproveRefillRequests,
  canCreateRefillRequests,
  roleFromEmployee,
} from "@/lib/roles";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

// GET /api/reports/stock-refill?warehouse=1102&status=needs_refill
//
// Watchlist now has two scopes:
//   sales_agg  — one row per item, current_stock = SUM across all active
//                sales warehouses, compared against a single (min, target)
//                threshold stored with warehouse_code = '' (sentinel).
//   warehouse  — one row per (warehouse, item) for non-sales warehouses
//                (main/transit). Stock is per-warehouse as before.
//
// The ?warehouse filter only narrows the "warehouse" scope rows.
// sales_agg rows are always returned (they don't belong to any single
// warehouse).

type WatchRow = {
  scope: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_name: string | null;
  min_qty: string | number | null;
  target_qty: string | number | null;
  current_stock: string | number | null;
  open_request_id: bigint | null;
  open_request_status: string | null;
  open_request_qty: string | number | null;
};

type ReqRow = {
  id: bigint;
  warehouse_code: string | null;
  warehouse_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_name: string | null;
  requested_qty: string | number;
  status: string;
  requestor_code: string;
  requestor_name: string | null;
  approver_code: string | null;
  approver_name: string | null;
  fulfiller_code: string | null;
  fulfiller_name: string | null;
  reason: string | null;
  approver_note: string | null;
  ref_doc_no: string | null;
  snapshot_stock: string | number | null;
  snapshot_min: string | number | null;
  snapshot_target: string | number | null;
  requested_at: Date;
  decided_at: Date | null;
  fulfilled_at: Date | null;
};

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = roleFromEmployee(employee);
  const warehouse = request.nextUrl.searchParams.get("warehouse")?.trim() ?? "";
  // 'needs_refill' (default) = current <= target. 'critical' = current <= min.
  const statusParam = (request.nextUrl.searchParams.get("status") ?? "needs_refill").trim();
  const wantCritical = statusParam === "critical";

  // Per-warehouse rules: only return rules for warehouses NOT in the active
  // sales-warehouse set (sales warehouses are covered by the sales_agg rule).
  const warehouseFilter = warehouse
    ? Prisma.sql`AND sm.warehouse_code = ${warehouse}`
    : Prisma.empty;

  // The watchlist is a UNION of two query shapes — sales_agg and per-warehouse.
  // Sales_agg sums the current stock across all active sales warehouses; the
  // per-warehouse arm preserves the original 1-row-per-(warehouse,item)
  // behaviour but excludes sales warehouses (their per-warehouse rules
  // should not exist after the migration, but we filter defensively).
  const items = await prisma.$queryRaw<WatchRow[]>`
    WITH sales_codes AS (
      SELECT warehouse_code
      FROM app_sales_warehouse
      WHERE is_active = TRUE
    ),
    -- Sales aggregate: 1 row per item, summed stock across sales warehouses.
    sales_agg_rule AS (
      SELECT sm.id, sm.item_code, sm.min_qty, sm.target_qty
      FROM app_stock_minimum sm
      WHERE sm.scope = 'sales_agg'
    ),
    sales_agg_balance AS (
      SELECT ic_code, SUM(balance_qty) AS qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        (SELECT string_agg(DISTINCT item_code, ',') FROM sales_agg_rule),
        (SELECT string_agg(DISTINCT warehouse_code, ',') FROM sales_codes)
      )
      WHERE warehouse IN (SELECT warehouse_code FROM sales_codes)
      GROUP BY ic_code
    ),
    -- Per-warehouse balance only computed for non-sales warehouses.
    per_wh_rule AS (
      SELECT sm.id, sm.warehouse_code, sm.item_code, sm.min_qty, sm.target_qty
      FROM app_stock_minimum sm
      WHERE sm.scope = 'warehouse'
        AND sm.warehouse_code NOT IN (SELECT warehouse_code FROM sales_codes)
        ${warehouseFilter}
    ),
    per_wh_balance AS (
      SELECT ic_code, warehouse, SUM(balance_qty) AS qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        (SELECT string_agg(DISTINCT item_code, ',') FROM per_wh_rule),
        (SELECT string_agg(DISTINCT warehouse_code, ',') FROM per_wh_rule)
      )
      GROUP BY ic_code, warehouse
    ),
    -- Most recent open request per (warehouse_code, item_code). NULL
    -- warehouse_code maps to sales_agg rows.
    open_req AS (
      SELECT DISTINCT ON (COALESCE(warehouse_code, ''), item_code)
        warehouse_code, item_code, id, status, requested_qty
      FROM app_stock_refill_request
      WHERE status IN ('pending', 'approved')
      ORDER BY COALESCE(warehouse_code, ''), item_code, requested_at DESC
    ),
    rows_combined AS (
      -- sales_agg arm
      SELECT
        'sales_agg'::text AS scope,
        NULL::varchar AS warehouse_code,
        NULL::varchar AS warehouse_name,
        r.item_code,
        i.name_1 AS item_name,
        i.unit_standard_name AS unit_name,
        r.min_qty,
        r.target_qty,
        COALESCE(b.qty, 0) AS current_stock,
        o.id AS open_request_id,
        o.status AS open_request_status,
        o.requested_qty AS open_request_qty
      FROM sales_agg_rule r
      LEFT JOIN ic_inventory i ON i.code = r.item_code
      LEFT JOIN sales_agg_balance b ON b.ic_code = r.item_code
      LEFT JOIN open_req o
        ON o.warehouse_code IS NULL AND o.item_code = r.item_code
      WHERE 1=1
        ${
          warehouse
            ? // when user filters by a specific warehouse, only show
              // sales_agg rows if it's one of the sales warehouses
              Prisma.sql`AND ${warehouse} IN (SELECT warehouse_code FROM sales_codes)`
            : Prisma.empty
        }

      UNION ALL

      -- per-warehouse arm (non-sales warehouses only)
      SELECT
        'warehouse'::text AS scope,
        r.warehouse_code,
        wh.name_1 AS warehouse_name,
        r.item_code,
        i.name_1 AS item_name,
        i.unit_standard_name AS unit_name,
        r.min_qty,
        r.target_qty,
        COALESCE(b.qty, 0) AS current_stock,
        o.id AS open_request_id,
        o.status AS open_request_status,
        o.requested_qty AS open_request_qty
      FROM per_wh_rule r
      LEFT JOIN ic_warehouse wh ON wh.code = r.warehouse_code
      LEFT JOIN ic_inventory i ON i.code = r.item_code
      LEFT JOIN per_wh_balance b
        ON b.ic_code = r.item_code AND b.warehouse = r.warehouse_code
      LEFT JOIN open_req o
        ON o.warehouse_code = r.warehouse_code AND o.item_code = r.item_code
    )
    SELECT *
    FROM rows_combined
    WHERE
      ${
        wantCritical
          ? Prisma.sql`current_stock <= min_qty`
          : Prisma.sql`current_stock <= target_qty`
      }
    ORDER BY
      (current_stock / NULLIF(target_qty, 0)) ASC NULLS FIRST,
      scope DESC,
      COALESCE(warehouse_code, ''),
      item_code
    LIMIT 500
  `;

  // Recent requests (any status). General (sales_agg) requests have
  // warehouse_code IS NULL — show them regardless of the warehouse filter
  // since they aren't tied to a specific warehouse.
  const requests = await prisma.$queryRaw<ReqRow[]>`
    SELECT
      r.id,
      r.warehouse_code,
      wh.name_1 AS warehouse_name,
      r.item_code,
      i.name_1 AS item_name,
      i.unit_standard_name AS unit_name,
      r.requested_qty,
      r.status,
      r.requestor_code,
      COALESCE(reqEmp.fullname_lo, reqEmp.nickname, r.requestor_code) AS requestor_name,
      r.approver_code,
      COALESCE(appEmp.fullname_lo, appEmp.nickname, r.approver_code) AS approver_name,
      r.fulfiller_code,
      COALESCE(fulfEmp.fullname_lo, fulfEmp.nickname, r.fulfiller_code) AS fulfiller_name,
      r.reason,
      r.approver_note,
      r.ref_doc_no,
      r.snapshot_stock,
      r.snapshot_min,
      r.snapshot_target,
      r.requested_at,
      r.decided_at,
      r.fulfilled_at
    FROM app_stock_refill_request r
    LEFT JOIN ic_warehouse wh ON wh.code = r.warehouse_code
    LEFT JOIN ic_inventory i ON i.code = r.item_code
    LEFT JOIN odg_employee reqEmp ON reqEmp.employee_code = r.requestor_code
    LEFT JOIN odg_employee appEmp ON appEmp.employee_code = r.approver_code
    LEFT JOIN odg_employee fulfEmp ON fulfEmp.employee_code = r.fulfiller_code
    WHERE 1=1
      ${
        warehouse
          ? Prisma.sql`AND (r.warehouse_code = ${warehouse} OR r.warehouse_code IS NULL)`
          : Prisma.empty
      }
    ORDER BY r.requested_at DESC
    LIMIT 200
  `;

  return NextResponse.json({
    canApprove: canApproveRefillRequests(role),
    canCreate: canCreateRefillRequests(role),
    items: items.map((row) => {
      const minQty = toNumber(row.min_qty);
      const targetQty = toNumber(row.target_qty);
      const currentStock = toNumber(row.current_stock);
      const status =
        currentStock <= 0
          ? "out"
          : minQty > 0 && currentStock < minQty
            ? "low"
            : targetQty > 0 && currentStock < targetQty
              ? "below_target"
              : "ok";
      return {
        scope: row.scope,
        warehouseCode: row.warehouse_code,
        warehouseName: row.warehouse_name?.trim() || row.warehouse_code,
        itemCode: row.item_code,
        itemName: row.item_name?.trim() || row.item_code,
        unitName: row.unit_name?.trim() || null,
        minQty,
        targetQty,
        currentStock,
        suggestedQty: Math.max(0, targetQty - currentStock),
        status,
        openRequestId: row.open_request_id ? row.open_request_id.toString() : null,
        openRequestStatus: row.open_request_status,
        openRequestQty: row.open_request_qty ? Number(row.open_request_qty) : null,
      };
    }),
    requests: requests.map((r) => ({
      id: r.id.toString(),
      warehouseCode: r.warehouse_code,
      warehouseName: r.warehouse_code
        ? r.warehouse_name?.trim() || r.warehouse_code
        : null,
      itemCode: r.item_code,
      itemName: r.item_name?.trim() || r.item_code,
      unitName: r.unit_name?.trim() || null,
      requestedQty: Number(r.requested_qty),
      status: r.status,
      requestorCode: r.requestor_code,
      requestorName: r.requestor_name,
      approverCode: r.approver_code,
      approverName: r.approver_name,
      fulfillerCode: r.fulfiller_code,
      fulfillerName: r.fulfiller_name,
      reason: r.reason,
      approverNote: r.approver_note,
      refDocNo: r.ref_doc_no,
      snapshotStock: r.snapshot_stock !== null ? Number(r.snapshot_stock) : null,
      snapshotMin: r.snapshot_min !== null ? Number(r.snapshot_min) : null,
      snapshotTarget: r.snapshot_target !== null ? Number(r.snapshot_target) : null,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      fulfilledAt: r.fulfilled_at,
    })),
  });
}

// POST /api/reports/stock-refill — open a new request.
// warehouseCode = null  →  sales aggregate (general) request
// warehouseCode = code  →  per-warehouse request
type CreateBody = {
  warehouseCode?: string | null;
  itemCode?: string;
  requestedQty?: number | string;
  reason?: string;
};

export async function POST(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canCreateRefillRequests(roleFromEmployee(me))) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດສ້າງຄຳຂໍ" },
      { status: 403 },
    );
  }
  if (!me.employeeCode) {
    return NextResponse.json({ error: "ບໍ່ມີ employeeCode" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  const rawWh = body?.warehouseCode;
  // Treat missing, null, and empty string as "general / sales aggregate".
  const warehouseCode =
    typeof rawWh === "string" && rawWh.trim() ? rawWh.trim() : null;
  const itemCode = body?.itemCode?.trim();
  const requestedQty = Number(body?.requestedQty);
  const reason = body?.reason?.trim() ?? null;

  if (!itemCode) {
    return NextResponse.json({ error: "itemCode ຈຳເປັນ" }, { status: 400 });
  }
  if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
    return NextResponse.json(
      { error: "requestedQty ຕ້ອງເປັນເລກບວກ" },
      { status: 400 },
    );
  }

  // Block creating a second request when one is already in flight. The
  // (warehouse, item) tuple matches by NULL-aware equality so general and
  // per-warehouse requests don't collide with each other.
  const existing = await prisma.$queryRaw<Array<{ id: bigint; status: string }>>`
    SELECT id, status
    FROM app_stock_refill_request
    WHERE item_code = ${itemCode}
      AND status IN ('pending', 'approved')
      AND warehouse_code IS NOT DISTINCT FROM ${warehouseCode}
    ORDER BY requested_at DESC
    LIMIT 1
  `;
  if (existing.length > 0) {
    return NextResponse.json(
      {
        error: `ມີຄຳຂໍຄ້າງຢູ່ແລ້ວ (${existing[0].status}) — ປິດກ່ອນຈຶ່ງສ້າງໃໝ່`,
      },
      { status: 409 },
    );
  }

  // Snapshot current stock + threshold values at request time so the audit
  // view stays meaningful even after the live values move. For sales_agg
  // requests, "current stock" = SUM across active sales warehouses.
  let snapshotStock: number | null = null;
  let snapshotMin: number | null = null;
  let snapshotTarget: number | null = null;

  if (warehouseCode === null) {
    const snap = await prisma.$queryRaw<
      Array<{
        min_qty: string | number | null;
        target_qty: string | number | null;
        current_stock: string | number | null;
      }>
    >`
      WITH sales_codes AS (
        SELECT warehouse_code FROM app_sales_warehouse WHERE is_active = TRUE
      ),
      stock AS (
        SELECT SUM(balance_qty) AS qty
        FROM public.sml_ic_function_stock_balance_warehouse(
          ${STOCK_BALANCE_AS_OF_DATE}::date,
          ${itemCode},
          (SELECT string_agg(warehouse_code, ',') FROM sales_codes)
        )
        WHERE warehouse IN (SELECT warehouse_code FROM sales_codes)
      )
      SELECT
        sm.min_qty,
        sm.target_qty,
        (SELECT COALESCE(qty, 0) FROM stock) AS current_stock
      FROM app_stock_minimum sm
      WHERE sm.scope = 'sales_agg' AND sm.item_code = ${itemCode}
      LIMIT 1
    `;
    snapshotMin = snap[0]?.min_qty !== undefined ? toNumber(snap[0].min_qty) : null;
    snapshotTarget = snap[0]?.target_qty !== undefined ? toNumber(snap[0].target_qty) : null;
    snapshotStock = snap[0]?.current_stock !== undefined ? toNumber(snap[0].current_stock) : null;
  } else {
    const snap = await prisma.$queryRaw<
      Array<{
        min_qty: string | number | null;
        target_qty: string | number | null;
        current_stock: string | number | null;
      }>
    >`
      SELECT
        sm.min_qty,
        sm.target_qty,
        (
          SELECT COALESCE(SUM(b.balance_qty), 0)
          FROM public.sml_ic_function_stock_balance_warehouse(
            ${STOCK_BALANCE_AS_OF_DATE}::date,
            ${itemCode},
            ${warehouseCode}
          ) b
          WHERE b.ic_code = sm.item_code AND b.warehouse = sm.warehouse_code
        ) AS current_stock
      FROM app_stock_minimum sm
      WHERE sm.scope = 'warehouse'
        AND sm.warehouse_code = ${warehouseCode}
        AND sm.item_code = ${itemCode}
      LIMIT 1
    `;
    snapshotMin = snap[0]?.min_qty !== undefined ? toNumber(snap[0].min_qty) : null;
    snapshotTarget = snap[0]?.target_qty !== undefined ? toNumber(snap[0].target_qty) : null;
    snapshotStock = snap[0]?.current_stock !== undefined ? toNumber(snap[0].current_stock) : null;
  }

  const inserted = await prisma.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO app_stock_refill_request (
      warehouse_code, item_code, requested_qty,
      status, requestor_code, reason,
      snapshot_stock, snapshot_min, snapshot_target
    )
    VALUES (
      ${warehouseCode}, ${itemCode}, ${requestedQty},
      'pending', ${me.employeeCode}, ${reason},
      ${snapshotStock}, ${snapshotMin}, ${snapshotTarget}
    )
    RETURNING id
  `;

  return NextResponse.json(
    { id: inserted[0]?.id.toString() ?? null },
    { status: 201 },
  );
}
