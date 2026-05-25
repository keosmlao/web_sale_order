import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";
import { notifyByRole } from "@/lib/notify";
import { canBeSalesperson, roleFromEmployee } from "@/lib/roles";
import { applyPromotions } from "@/lib/promotions-engine";

const DEFAULT_SIDE_CODE = "200";

type OrderItemJson = {
  id: number;
  productId: string;
  quantity: number | string | null;
  unitPrice: number | string | null;
  subtotal: number | string | null;
  productName: string | null;
  unitName: string | null;
  whCode: string | null;
};

type OrderRow = {
  id: string;
  doc_no: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: number | null;
  is_scheduled: boolean | null;
  total: string | number | null;
  earned_points: string | number | null;
  earn_kip_per_point: string | number | null;
  point_name: string | null;
  created_at: Date;
  warehouse_code: string | null;
  salesperson_code: string | null;
  salesperson_name_lo: string | null;
  salesperson_name_en: string | null;
  salesperson_nickname: string | null;
  items: OrderItemJson[] | null;
};

type ProductRow = {
  code: string;
  name_1: string | null;
  unit_standard_name: string | null;
  item_category: string | null;
  group_main: string | null;
  sale_price_kip: string | number | null;
  has_set: boolean | null;
};

type BalanceRow = {
  ic_code: string | null;
  warehouse: string | null;
  location: string | null;
  balance_qty: string | null;
};

type LoyaltyConfigRow = {
  earn_kip_per_point: string | number | null;
  point_name: string | null;
  is_active: boolean | null;
};

type IncomingItem = {
  productId: string;
  quantity: number;
  warehouseCode: string | null;
  locationCode: string | null;
  // Optional per-line salesperson override. When the POS sends a value
  // here it wins over the cart-level salespersonCode for that line's
  // ic_trans_detail.sale_code; absent → fall back to cart-level.
  salespersonCode: string | null;
};

function parseDiscountPct(raw: string | number | null): number {
  if (raw === null) return 0;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(
  status: number | null,
  isScheduled = false,
): "PENDING" | "COMPLETED" | "CANCELLED" | "SCHEDULED" {
  if (status === 2) return "CANCELLED";
  // "ຈັດຖ້ຽວ" is a derived state: SOK was settled (status=1) AND a
  // odg_tms_detail row references its CAKAP doc_no. We surface it as a
  // distinct label so the cashier / salesperson see fulfilment progress.
  if (status === 1) return isScheduled ? "SCHEDULED" : "COMPLETED";
  return "PENDING";
}

function toOrder(row: OrderRow) {
  const items = row.items ?? [];
  const salesperson = row.salesperson_code
    ? {
        employeeCode: row.salesperson_code,
        fullnameLo: row.salesperson_name_lo,
        fullnameEn: row.salesperson_name_en,
        nickname: row.salesperson_nickname,
      }
    : null;
  return {
    id: row.id,
    // Full SML doc_no (eg. SOK26050001) so the mobile app can display the
    // canonical document identifier; `id` is still the short cart_number
    // suffix used as the URL key.
    docNo: row.doc_no,
    customerId: row.customer_id,
    customer: {
      id: row.customer_id,
      name: row.customer_name || row.customer_id || "—",
      phone: row.customer_phone,
      email: null,
      address: null,
    },
    warehouseCode: row.warehouse_code,
    salesperson,
    status: statusLabel(row.status, row.is_scheduled === true),
    total: row.total ? Number(row.total) : 0,
    loyalty: {
      earnedPoints: row.earned_points ? Number(row.earned_points) : 0,
      earnKipPerPoint: row.earn_kip_per_point
        ? Number(row.earn_kip_per_point)
        : 0,
      pointName: row.point_name?.trim() || "ແຕ້ມສະສົມ",
    },
    createdAt: row.created_at,
    items: items.map((item) => ({
      id: String(item.id),
      productId: item.productId,
      quantity: item.quantity ? Number(item.quantity) : 0,
      unitPrice: item.unitPrice ? Number(item.unitPrice) : 0,
      warehouseCode: item.whCode,
      product: {
        id: item.productId,
        code: item.productId,
        name: item.productName || item.productId,
        description: null,
        price: item.unitPrice ? Number(item.unitPrice) : 0,
        stock: 0,
        imageUrl: null,
        unitName: item.unitName,
      },
    })),
  };
}

function normalizeItems(rawItems: unknown[], fallbackWarehouseCode: string | null): IncomingItem[] {
  return rawItems
    .filter(
      (i): i is IncomingItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as IncomingItem).productId === "string" &&
        typeof (i as IncomingItem).quantity === "number" &&
        (i as IncomingItem).quantity > 0,
    )
    .map((i) => ({
      productId: i.productId.trim(),
      quantity: Math.floor(i.quantity),
      warehouseCode:
        typeof i.warehouseCode === "string" && i.warehouseCode.trim() !== ""
          ? i.warehouseCode.trim()
          : fallbackWarehouseCode,
      locationCode:
        typeof (i as { locationCode?: unknown }).locationCode === "string" &&
        (i as { locationCode: string }).locationCode.trim() !== ""
          ? (i as { locationCode: string }).locationCode.trim()
          : null,
      salespersonCode:
        typeof (i as { salespersonCode?: unknown }).salespersonCode ===
          "string" &&
        (i as { salespersonCode: string }).salespersonCode.trim() !== ""
          ? (i as { salespersonCode: string }).salespersonCode.trim()
          : null,
    }))
    .filter((i) => i.productId.length > 0 && i.quantity > 0);
}

function orderUnitCode(product: ProductRow): string {
  const airSet =
    (product.item_category?.trim() === "032" ||
      product.group_main?.trim() === "12") &&
    product.has_set === true;
  if (airSet) return "ຊຸດ";
  return product.unit_standard_name ?? "";
}

function calculateEarnedPoints(totalKip: number, earnKipPerPoint: number) {
  if (!Number.isFinite(totalKip) || !Number.isFinite(earnKipPerPoint)) return 0;
  if (totalKip <= 0 || earnKipPerPoint <= 0) return 0;
  return Math.floor(totalKip / earnKipPerPoint);
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const employeeCode = employee.employeeCode?.trim();
  if (!employeeCode) {
    return NextResponse.json([]);
  }

  // The cart_number returned to the mobile app is the 5-digit doc_no
  // suffix (chars 6+ of doc_no like SOK2600123 → "00123"). The Flutter app
  // still keys orders by this 5-character id, so we strip the SOK/YY
  // prefix server-side rather than break the contract.
  const rows = await prisma.$queryRaw<OrderRow[]>`
    SELECT
      SUBSTRING(t.doc_no FROM 6) AS id,
      t.doc_no,
      t.cust_code AS customer_id,
      ar.name_1 AS customer_name,
      ar.telephone AS customer_phone,
      t.status,
      (
        t.status = 1 AND EXISTS (
          SELECT 1 FROM odg_tms_detail w
          WHERE w.bill_no = t.tax_doc_no
        )
      ) AS is_scheduled,
      t.total_amount_2 AS total,
      COALESCE(t.sum_point, t.get_new_point, 0) AS earned_points,
      lc.earn_kip_per_point,
      lc.point_name,
      t.create_date_time_now AS created_at,
      eff.salesperson_code,
      emp.fullname_lo AS salesperson_name_lo,
      emp.fullname_en AS salesperson_name_en,
      emp.nickname AS salesperson_nickname,
      COALESCE(
        json_agg(
          json_build_object(
            'id', d.line_number,
            'productId', d.item_code,
            'quantity', d.qty,
            'unitPrice', d.price_2,
            'subtotal', d.sum_amount_2,
            'productName', p.name_1,
            'unitName', COALESCE(NULLIF(d.unit_code, ''), p.unit_standard_name),
            'whCode', NULLIF(d.wh_code, '')
          )
          ORDER BY d.line_number
        ) FILTER (WHERE d.line_number IS NOT NULL),
        '[]'::json
      ) AS items,
      eff.warehouse_code
    FROM ic_trans t
    LEFT JOIN ar_customer ar ON ar.code = t.cust_code
    LEFT JOIN ic_trans_detail d
      ON d.doc_no = t.doc_no
      AND d.trans_type = t.trans_type
      AND d.trans_flag = t.trans_flag
    LEFT JOIN ic_inventory p ON p.code = d.item_code
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          NULLIF(NULLIF(t.sale_code, ''), '00000'),
          NULLIF(NULLIF((
            SELECT d2.sale_code
            FROM ic_trans_detail d2
            WHERE d2.doc_no = t.doc_no
              AND d2.trans_type = t.trans_type
              AND d2.trans_flag = t.trans_flag
            ORDER BY d2.line_number
            LIMIT 1
          ), ''), '00000'),
          NULLIF(t.creator_code, '')
        ) AS salesperson_code,
        COALESCE(
          NULLIF(t.wh_from, ''),
          NULLIF((
            SELECT d3.wh_code
            FROM ic_trans_detail d3
            WHERE d3.doc_no = t.doc_no
              AND d3.trans_type = t.trans_type
              AND d3.trans_flag = t.trans_flag
            ORDER BY d3.line_number
            LIMIT 1
          ), '')
        ) AS warehouse_code
    ) eff ON true
    LEFT JOIN odg_employee emp ON emp.employee_code = eff.salesperson_code
    LEFT JOIN LATERAL (
      SELECT earn_kip_per_point, point_name
      FROM app_loyalty_config
      ORDER BY updated_at DESC
      LIMIT 1
    ) lc ON true
    WHERE t.doc_format_code = 'SOK'
      AND eff.salesperson_code = ${employeeCode}
    GROUP BY
      t.doc_no,
      t.tax_doc_no,
      t.cust_code,
      ar.name_1,
      ar.telephone,
      t.status,
      t.total_amount_2,
      t.sum_point,
      t.get_new_point,
      lc.earn_kip_per_point,
      lc.point_name,
      t.create_date_time_now,
      eff.salesperson_code,
      eff.warehouse_code,
      emp.fullname_lo,
      emp.fullname_en,
      emp.nickname
    ORDER BY t.create_date_time_now DESC
    LIMIT 100
  `;

  return NextResponse.json(rows.map(toOrder));
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        customerId?: unknown;
        warehouseCode?: unknown;
        deliveryName?: unknown;
        discountPct?: unknown;
        note?: unknown;
        extraDiscount?: unknown;
        salespersonCode?: unknown;
        items?: unknown;
        priceRequests?: unknown;
      }
    | null;
  const customerId = typeof body?.customerId === "string" ? body.customerId.trim() : "";
  const warehouseCode =
    typeof body?.warehouseCode === "string" && body.warehouseCode.trim() !== ""
      ? body.warehouseCode.trim()
      : null;
  const deliveryName =
    typeof body?.deliveryName === "string" && body.deliveryName.trim() !== ""
      ? body.deliveryName.trim()
      : null;
  const note =
    typeof body?.note === "string" && body.note.trim() !== ""
      ? body.note.trim()
      : null;
  // Bill-level discount in KIP — subtracted from the cart total AFTER the
  // customer's per-line discount has been applied. Stored implicitly: line
  // amounts stay accurate, only `order_cart.amount` is reduced.
  const extraDiscount =
    typeof body?.extraDiscount === "number" && body.extraDiscount > 0
      ? body.extraDiscount
      : 0;
  // Optional salesperson — when omitted the order is credited to the
  // logged-in user. When provided we still validate the code exists and is
  // ACTIVE so the picker can't be bypassed with a stale id.
  const salespersonCodeRaw =
    typeof body?.salespersonCode === "string"
      ? body.salespersonCode.trim()
      : "";
  const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const items = normalizeItems(rawItems, warehouseCode);

  // Per-item special-price requests: { productId, reason }
  // The cart is inserted with original prices — these rows go into
  // app_price_request and only kick in once a manager approves AND sets
  // the approved price. Requestors no longer supply a number themselves.
  type IncomingPriceRequest = {
    productId: string;
    reason: string | null;
  };
  const rawPriceRequests: unknown[] = Array.isArray(body?.priceRequests)
    ? body.priceRequests
    : [];
  const priceRequests: IncomingPriceRequest[] = rawPriceRequests
    .filter(
      (r): r is { productId: string; reason?: unknown } =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { productId?: unknown }).productId === "string",
    )
    .map((r) => ({
      productId: r.productId.trim(),
      reason: typeof r.reason === "string" && r.reason.trim() !== ""
        ? r.reason.trim()
        : null,
    }))
    .filter((r) => r.productId.length > 0);

  // Walk-in support: customerId may be empty. When blank, the SOK gets an
  // empty cust_code, no member discount, no loyalty earn, and no
  // approved-price-request lookup. The settle endpoint already accepts
  // SOKs with empty cust_code as walk-in sales.
  const isWalkIn = !customerId;

  if (items.length === 0) {
    return NextResponse.json({ error: "items must contain at least one entry" }, { status: 400 });
  }
  if (items.some((item) => !item.warehouseCode)) {
    return NextResponse.json(
      { error: "warehouseCode is required for every item" },
      { status: 400 },
    );
  }
  // locationCode is optional — when blank, the order is checked against
  // the warehouse-level stock total (used when the per-location query
  // returns no rows but the warehouse cache reports stock).

  type CustomerRow = {
    code: string;
    name_1: string | null;
    telephone: string | null;
    reg_group: string | null;
    group_code: string | null;
    discount_raw: string | number | null;
    point_balance: string | number | null;
  };
  const customers: CustomerRow[] = isWalkIn
    ? []
    : await prisma.$queryRaw<CustomerRow[]>`
        SELECT
          ar.code,
          ar.name_1,
          ar.telephone,
          ar.reg_group,
          d.group_sub_1 AS group_code,
          NULLIF(d.discount_item, '') AS discount_raw,
          ar.point_balance
        FROM ar_customer ar
        LEFT JOIN ar_customer_detail d ON d.ar_code = ar.code
        LEFT JOIN ar_group_sub g ON g.code = d.group_sub_1
        WHERE ar.code = ${customerId}
        LIMIT 1
      `;
  if (!isWalkIn && !customers[0]) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  const customerRegGroup =
    customers[0]?.reg_group?.trim().toLowerCase() ?? "";
  if (!isWalkIn && customerRegGroup !== "member") {
    return NextResponse.json(
      { error: "ລູກຄ້າຕ້ອງເປັນສະມາຊິກ" },
      { status: 400 },
    );
  }
  const customerDiscountPct = isWalkIn
    ? 0
    : parseDiscountPct(customers[0]?.discount_raw ?? null);
  const discountPct = customerDiscountPct;

  const productIds = [...new Set(items.map((i) => i.productId))];
  const warehouseCodes = [...new Set(items.map((i) => i.warehouseCode).filter(Boolean))] as string[];
  const codeList = productIds.join(",");
  const warehouseList = warehouseCodes.join(",");
  const [products, balances, approvedPrices] = await Promise.all([
    prisma.$queryRaw<ProductRow[]>`
      SELECT
        i.code,
        i.name_1,
        i.unit_standard_name,
        i.item_category,
        i.group_main,
        price.sale_price_kip,
        EXISTS (
          SELECT 1
          FROM ic_inventory_set_detail d
          WHERE d.ic_set_code = i.code
            AND COALESCE(d.status, 0) <> 1
        ) AS has_set
      FROM ic_inventory i
      LEFT JOIN LATERAL (
        SELECT sale_price1 AS sale_price_kip
        FROM ic_inventory_price
        WHERE ic_code = i.code
          AND currency_code = '02'
          AND COALESCE(sale_price1, 0) > 0
          AND COALESCE(status, 1) = 1
        ORDER BY
          COALESCE(to_date, '2099-12-31'::date) DESC,
          COALESCE(from_date, '1900-01-01'::date) DESC,
          COALESCE(create_date_time_now, create_now) DESC,
          roworder DESC
        LIMIT 1
      ) price ON true
      WHERE i.code IN (${Prisma.join(productIds)})
    `,
    prisma.$queryRaw<BalanceRow[]>`
      SELECT ic_code, warehouse, location, SUM(balance_qty) AS balance_qty
      FROM public.sml_ic_function_stock_balance_warehouse_location(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        ${codeList},
        ${warehouseList},
        ''
      )
      GROUP BY ic_code, warehouse, location
    `,
    // Approved standalone price requests for this customer × any of the
    // items in the cart. Server side authoritatively wins so the salesperson
    // can't bypass approval by ignoring the override. Walk-in sales skip
    // this lookup entirely — no customer to key on.
    isWalkIn
      ? Promise.resolve([])
      : prisma.appPriceRequest.findMany({
          where: {
            customerCode: customerId,
            itemCode: { in: productIds },
            status: "approved",
            cartNumber: null,
          },
          orderBy: { decidedAt: "desc" },
        }),
  ]);

  // Latest approved request wins per item (orderBy DESC + first-seen below).
  // requestedPrice is now nullable on the row — only approved rows where the
  // manager actually set a price are eligible to override.
  const approvedPriceMap = new Map<string, number>();
  for (const pr of approvedPrices) {
    if (approvedPriceMap.has(pr.itemCode)) continue;
    if (pr.requestedPrice === null) continue;
    approvedPriceMap.set(pr.itemCode, Number(pr.requestedPrice));
  }
  function effectivePrice(p: ProductRow): number {
    const override = approvedPriceMap.get(p.code);
    if (override !== undefined && override > 0) return override;
    return p.sale_price_kip ? Number(p.sale_price_kip) : 0;
  }

  const productMap = new Map(products.map((p) => [p.code, p]));
  const balanceMap = new Map(
    balances
      .filter((b) => b.ic_code && b.warehouse && b.location)
      .map((b) => [
        `${b.warehouse!}\x1f${b.location!}\x1f${b.ic_code!}`,
        b.balance_qty ? Number(b.balance_qty) : 0,
      ]),
  );
  // Warehouse-level rollup — sums all locations within a warehouse, used
  // when the cart line has no specific locationCode picked (per-location
  // breakdown was unavailable in the picker but warehouse cache said yes).
  const warehouseBalanceMap = new Map<string, number>();
  for (const b of balances) {
    if (!b.ic_code || !b.warehouse) continue;
    const key = `${b.warehouse}\x1f${b.ic_code}`;
    const prev = warehouseBalanceMap.get(key) ?? 0;
    warehouseBalanceMap.set(key, prev + (b.balance_qty ? Number(b.balance_qty) : 0));
  }

  // Set products (ic_inventory_set) carry no pre-built balance — they're
  // assembled from components at sale time. Resolve every set in the cart
  // into its component lines and fetch the components' warehouse balances so
  // the stock check below validates against components, not the set itself.
  const setCartIds = items
    .filter((it) => productMap.get(it.productId)?.has_set === true)
    .map((it) => it.productId);
  const uniqueSetIds = [...new Set(setCartIds)];
  type SetDetailRow = {
    ic_set_code: string;
    item_code: string;
    item_name: string | null;
    qty: string | number | null;
  };
  const setDetails =
    uniqueSetIds.length > 0
      ? await prisma.$queryRaw<SetDetailRow[]>`
          SELECT
            d.ic_set_code,
            d.ic_code AS item_code,
            i.name_1 AS item_name,
            d.qty
          FROM ic_inventory_set_detail d
          LEFT JOIN ic_inventory i ON i.code = d.ic_code
          WHERE d.ic_set_code IN (${Prisma.join(uniqueSetIds)})
            AND COALESCE(d.status, 0) <> 1
        `
      : [];
  const setComponentsMap = new Map<
    string,
    Array<{ itemCode: string; itemName: string | null; qty: number }>
  >();
  for (const row of setDetails) {
    const list = setComponentsMap.get(row.ic_set_code) ?? [];
    list.push({
      itemCode: row.item_code,
      itemName: row.item_name,
      qty: Number(row.qty ?? 0),
    });
    setComponentsMap.set(row.ic_set_code, list);
  }
  const componentCodes = [
    ...new Set(setDetails.map((r) => r.item_code).filter(Boolean)),
  ];
  const missingFromBalances = componentCodes.filter(
    (c) => !balances.some((b) => b.ic_code === c),
  );
  if (missingFromBalances.length > 0 && warehouseList) {
    const extraList = missingFromBalances.join(",");
    const extra = await prisma.$queryRaw<BalanceRow[]>`
      SELECT ic_code, warehouse, location, SUM(balance_qty) AS balance_qty
      FROM public.sml_ic_function_stock_balance_warehouse_location(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        ${extraList},
        ${warehouseList},
        ''
      )
      GROUP BY ic_code, warehouse, location
    `;
    for (const b of extra) {
      if (b.ic_code && b.warehouse && b.location) {
        balanceMap.set(
          `${b.warehouse}\x1f${b.location}\x1f${b.ic_code}`,
          b.balance_qty ? Number(b.balance_qty) : 0,
        );
      }
      if (b.ic_code && b.warehouse) {
        const key = `${b.warehouse}\x1f${b.ic_code}`;
        const prev = warehouseBalanceMap.get(key) ?? 0;
        warehouseBalanceMap.set(
          key,
          prev + (b.balance_qty ? Number(b.balance_qty) : 0),
        );
      }
    }
  }

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product) {
      return NextResponse.json(
        { error: `Product not found: ${item.productId}` },
        { status: 404 },
      );
    }
    if (product.has_set === true) {
      // Validate component-by-component. Stock is checked at the warehouse
      // level (sum across locations) since the components may live in any
      // condition shelf and the cashier didn't pick a location for the set.
      const components = setComponentsMap.get(item.productId) ?? [];
      if (components.length === 0) {
        return NextResponse.json(
          {
            error: `ສິນຄ້າຊຸດ ${product.name_1 ?? item.productId} ບໍ່ມີສ່ວນປະກອບ`,
          },
          { status: 400 },
        );
      }
      for (const c of components) {
        const required = c.qty * item.quantity;
        const balance =
          warehouseBalanceMap.get(`${item.warehouseCode}\x1f${c.itemCode}`) ?? 0;
        if (balance < required) {
          return NextResponse.json(
            {
              error: `stock ບໍ່ພໍ: ${c.itemName ?? c.itemCode} (ສ່ວນປະກອບຂອງ ${product.name_1 ?? item.productId}) ມີ ${balance}, ຕ້ອງການ ${required}`,
            },
            { status: 400 },
          );
        }
      }
      continue;
    }
    const balance = item.locationCode
      ? balanceMap.get(`${item.warehouseCode}\x1f${item.locationCode}\x1f${item.productId}`) ?? 0
      : warehouseBalanceMap.get(`${item.warehouseCode}\x1f${item.productId}`) ?? 0;
    if (balance < item.quantity) {
      return NextResponse.json(
        {
          error: `stock ບໍ່ພໍ: ${product.name_1 ?? item.productId} ມີ ${balance}, ຕ້ອງການ ${item.quantity}`,
        },
        { status: 400 },
      );
    }
  }

  // Resolve salesperson. PC users may create orders as data-entry, but the
  // credited salesperson must be an active non-PC user — AND must be opted
  // into the app via app_employee_access. Querying odg_employee directly
  // would let a stale HR code bypass the admin-managed access list.
  let salespersonCode = employee.employeeCode ?? "";
  const shouldLookupSalesperson =
    salespersonCodeRaw && salespersonCodeRaw !== employee.employeeCode;
  if (shouldLookupSalesperson) {
    const rows = await prisma.$queryRaw<
      Array<{
        employee_code: string | null;
        position_code: string | null;
        access_position_code: string | null;
        app_role: string | null;
      }>
    >`
      SELECT
        e.employee_code,
        e.position_code,
        a.position_code AS access_position_code,
        a.app_role
      FROM app_employee_access a
      JOIN odg_employee e ON e.employee_code = a.employee_code
      WHERE a.is_active = true
        AND e.employee_code = ${salespersonCodeRaw}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: `ບໍ່ພົບພະນັກງານຂາຍ: ${salespersonCodeRaw}` },
        { status: 404 },
      );
    }
    const salesperson = rows[0];
    const salespersonRole = roleFromEmployee({
      appRole: salesperson.app_role,
      positionCode:
        salesperson.access_position_code?.trim() ||
        salesperson.position_code?.trim() ||
        null,
    });
    if (!canBeSalesperson(salespersonRole)) {
      return NextResponse.json(
        { error: `ພະນັກງານນີ້ບໍ່ແມ່ນຜູ້ຂາຍ: ${salespersonCodeRaw}` },
        { status: 400 },
      );
    }
    salespersonCode =
      salesperson.employee_code ?? employee.employeeCode ?? "";
  } else if (!canBeSalesperson(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກພະນັກງານຂາຍ" },
      { status: 400 },
    );
  }
  const userOwner = salespersonCode;

  // Simple per-line pricing: gross = qty × price, then subtract the
  // customer's standing discount %. Active promotions are applied just below
  // using the same engine as the POS preview.
  type LinePricing = {
    item: IncomingItem;
    product: ProductRow | undefined;
    price: number;
    gross: number;
    customerDiscount: number;
    promoDiscount: number;
    promoLabel: string;
    amount: number;
  };
  const linePricing: LinePricing[] = items.map((item) => {
    const product = productMap.get(item.productId);
    const price = product ? effectivePrice(product) : 0;
    const gross = price * item.quantity;
    const customerDiscount = gross * (discountPct / 100);
    const amount = Math.max(0, gross - customerDiscount);
    return {
      item,
      product,
      price,
      gross,
      customerDiscount,
      promoDiscount: 0,
      promoLabel: "",
      amount,
    };
  });

  // Apply active promotions on top of the per-customer discount. The engine
  // mutates promoDiscount/promoLabel/amount in place so the existing line
  // total / bill-discount math below stays unchanged.
  const activePromos = await prisma.appPromotion.findMany({
    where: { isActive: true },
  });
  applyPromotions(
    linePricing.map((lp) => ({
      productId: lp.item.productId,
      quantity: lp.item.quantity,
      price: lp.price,
      gross: lp.gross,
      customerDiscount: lp.customerDiscount,
      promoDiscount: lp.promoDiscount,
      promoLabel: lp.promoLabel,
      amount: lp.amount,
    })),
    activePromos,
    new Date(),
  ).forEach((engineLine, i) => {
    const lp = linePricing[i];
    lp.promoDiscount = engineLine.promoDiscount;
    lp.promoLabel = engineLine.promoLabel;
    // The engine sets these two opt-out flags independently from the
    // touching promo. Member discount is dropped when the promo says
    // so; the awardsPoints flag is carried through to the earn calc.
    const tagged = lp as {
      awardsPoints?: boolean;
      awardsMemberDiscount?: boolean;
    };
    if (engineLine.awardsMemberDiscount === false) {
      lp.customerDiscount = 0;
      lp.amount = Math.max(0, lp.gross - lp.promoDiscount);
      tagged.awardsMemberDiscount = false;
    } else {
      lp.amount = engineLine.amount;
    }
    if (engineLine.awardsPoints === false) {
      tagged.awardsPoints = false;
    }
  });

  const lineTotal = linePricing.reduce((s, lp) => s + lp.amount, 0);
  // Loyalty points: only point-eligible lines accrue.
  const pointEligibleTotal = linePricing.reduce(
    (s, lp) =>
      s +
      ((lp as { awardsPoints?: boolean }).awardsPoints === false
        ? 0
        : lp.amount),
    0,
  );

  const appliedExtraDiscount = Math.min(extraDiscount, lineTotal);
  const total = lineTotal - appliedExtraDiscount;
  const loyaltyRows = await prisma.$queryRaw<LoyaltyConfigRow[]>`
    SELECT earn_kip_per_point, point_name, is_active
    FROM app_loyalty_config
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const loyaltyIsActive = loyaltyRows[0]?.is_active === true;
  const earnKipPerPoint = loyaltyIsActive && loyaltyRows[0]?.earn_kip_per_point
    ? Number(loyaltyRows[0].earn_kip_per_point)
    : 0;
  // Walk-in sales don't accrue loyalty — no member to credit. Promo
  // lines also don't earn; only the non-promo eligible total feeds
  // the earn calc.
  const pointEligibleAfterBill = Math.max(
    0,
    pointEligibleTotal - appliedExtraDiscount,
  );
  const earnedPoints = isWalkIn
    ? 0
    : calculateEarnedPoints(pointEligibleAfterBill, earnKipPerPoint);
  const customerPhone = customers[0]?.telephone?.trim() || "";
  const customerPointBalance = customers[0]?.point_balance
    ? Number(customers[0].point_balance)
    : 0;

  // Build a single remark string combining delivery info, bill discount,
  // and user note. The cashier settlement flow reads this back and prefixes
  // each piece in ic_trans.remark.
  const remarkParts: string[] = [];
  if (deliveryName) remarkParts.push(deliveryName);
  if (appliedExtraDiscount > 0) {
    remarkParts.push(`ສ່ວນຫຼຸດທ້າຍບິນ: ${appliedExtraDiscount}`);
  }
  if (note) remarkParts.push(`ໝາຍເຫດ: ${note}`);
  const remark = remarkParts.length === 0 ? null : remarkParts.join(" | ");

  // The sale order is recorded in SML ic_trans + ic_trans_detail only —
  // order_cart / order_item are no longer written. The 5-digit cart_number
  // is the suffix of the SOK doc_no so it still fits app_* tables that key
  // off VARCHAR(5).
  let cartNumber: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      cartNumber = await prisma.$transaction(async (tx) => {
    // ── SML SOK (Sale Order / Cash) ────────────────────────────────────
    //
    // Schema notes (SML KIP-currency convention):
    //   doc_format_code = 'SOK'
    //   trans_type      = 2  (sale family)
    //   trans_flag      = 36 (sale order, distinguishes from 44 = cash sale)
    //   vat_type        = 2  (VAT inclusive)
    //   currency_code   = '02' (KIP), exchange_rate from erp_currency
    //   total_amount    = THB equivalent (base)
    //   total_amount_2  = KIP native
    //   doc_no          = SOK + YY + MM + 4-digit seq  (e.g. SOK26050001)
    //                     sequence resets each month so back-office reports
    //                     can group by month from the doc_no alone.
    const SOK_DOC_PREFIX = "SOK";
    const SOK_TRANS_TYPE = 2;
    const SOK_TRANS_FLAG = 36;
    const SOK_INQUIRY_TYPE = 1;
    const SOK_VAT_TYPE = 2;
    const SOK_VAT_RATE = 10;
    // SML-created SOK order lines use the "order/reserve" convention below.
    // CAKAP settlement later writes stock-cutting detail rows with calc_flag=-1.
    const SOK_ITEM_TYPE = 0;
    const SOK_CALC_FLAG = 1;
    const SOK_PRICE_TYPE = -1;
    const SOK_SALE_GROUP = "WALKIN";
    const KIP_CURRENCY_CODE = "02";

    // Primary warehouse for the doc header = first item's warehouse.
    // Mixed-warehouse carts still write each line to its own wh in
    // ic_trans_detail; only the header carries a single wh_from.
    const primaryWh = (items[0].warehouseCode ?? "").trim();
    const whRows = await tx.$queryRaw<
      Array<{
        branch_code: string | null;
      }>
    >`
      SELECT branch_code
      FROM ic_warehouse
      WHERE code = ${primaryWh}
      LIMIT 1
    `;
    // Branch defaults to '01' when ic_warehouse has no override — keeps
    // back-office reports filtering by branch consistent for the single-
    // branch deployments that don't bother setting branch_code.
    const branchCode = (whRows[0]?.branch_code ?? "").trim() || "01";
    // department_code belongs to the salesperson, not the warehouse — daily
    // sales reports filter by seller's department, so we resolve it via
    // odg_employee instead of inheriting ic_warehouse.od_code.
    const empRows = await tx.$queryRaw<
      Array<{ department_code: string | null }>
    >`
      SELECT department_code FROM odg_employee
      WHERE employee_code = ${salespersonCode}
      LIMIT 1
    `;
    const departmentCode = (empRows[0]?.department_code ?? "").trim();
    const shelfRows = await tx.$queryRaw<Array<{ code: string }>>`
      SELECT code FROM ic_shelf
      WHERE whcode = ${primaryWh}
      ORDER BY code
      LIMIT 1
    `;
    const defaultShelfCode = shelfRows[0]?.code ?? `${primaryWh}01`;

    const rateRows = await tx.$queryRaw<
      Array<{ exchange_rate_present: string | number | null }>
    >`
      SELECT exchange_rate_present FROM erp_currency
      WHERE code = ${KIP_CURRENCY_CODE} LIMIT 1
    `;
    const exchangeRate = rateRows[0]?.exchange_rate_present
      ? Number(rateRows[0].exchange_rate_present)
      : 0;
    if (exchangeRate <= 0) {
      throw new Error(
        "ຍັງບໍ່ໄດ້ຕັ້ງຄ່າອັດຕາແລກປ່ຽນເງິນກີບໃນ erp_currency",
      );
    }

    // Doc number sequence: SOK + YY + MM + 4-digit. The seq resets each
    // month — pattern filters by SOK+YY+MM% and SUBSTRING from position
    // prefix.length + 5 (skip SOK + YY + MM) gives just the 4-digit suffix.
    const now = new Date();
    const yearSuffix = now.getFullYear().toString().slice(-2);
    const monthSuffix = (now.getMonth() + 1).toString().padStart(2, "0");
    const yymm = `${yearSuffix}${monthSuffix}`;
    const docNoPattern = `${SOK_DOC_PREFIX}${yymm}%`;
    // Serialize doc number allocation per prefix/year/month. Two concurrent
    // mobile clients in the same month would otherwise both read the same
    // MAX(seq) and collide on the unique (doc_no, trans_flag) PK.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`${SOK_DOC_PREFIX}:${yymm}`}))
    `;
    const seqRows = await tx.$queryRaw<Array<{ next_seq: number }>>`
      SELECT COALESCE(
        MAX(CAST(SUBSTRING(doc_no FROM ${SOK_DOC_PREFIX.length + 5}) AS INTEGER)),
        0
      ) + 1 AS next_seq
      FROM ic_trans
      WHERE doc_no LIKE ${docNoPattern}
        AND doc_format_code = ${SOK_DOC_PREFIX}
    `;
    let seq = seqRows[0]?.next_seq ?? 1;
    // Defensive: even though MAX(seq)+1 should be free under the advisory
    // lock, in practice we've seen 23505 collisions when a SOK was created
    // outside this transaction's snapshot window (manual SQL, prior crash
    // leaving a row, etc). Probe up to 20 numbers ahead before INSERT —
    // same pattern used by the CAKAP settle route. Caller's retry-on-23505
    // still wraps this as a last resort.
    let sokDocNo = `${SOK_DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
    let allocated = false;
    for (let probe = 0; probe < 20; probe++) {
      if (seq > 9999) {
        throw new Error("SOK sequence exhausted for this month (max 9999)");
      }
      const existsRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM ic_trans
          WHERE doc_no = ${sokDocNo}
            AND trans_flag = ${SOK_TRANS_FLAG}
        ) AS exists
      `;
      if (!existsRows[0]?.exists) {
        allocated = true;
        break;
      }
      seq += 1;
      sokDocNo = `${SOK_DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
    }
    if (!allocated) {
      throw new Error("ບໍ່ສາມາດຈອງເລກເອກະສານ SOK ໄດ້");
    }
    const generated = String(seq).padStart(4, "0");

    // Money rounded to 2 decimals for THB; KIP stays as integer-ish.
    const roundMoney = (n: number, decimals = 2) => {
      const f = Math.pow(10, decimals);
      return Math.round(n * f) / f;
    };
    // Header totals follow SML's order screen convention:
    // - line-level discounts live on ic_trans_detail only
    // - header discount fields are for a bill-level discount only
    // - total_value is the line net before the bill-level discount
    // This avoids SML subtracting the member line discount a second time when
    // it opens/recalculates the document.
    const headerValueKip = lineTotal;
    const headerDiscountKip = appliedExtraDiscount;
    const totalKip = total;
    const headerValueThb = roundMoney(headerValueKip * exchangeRate);
    const headerDiscountThb = roundMoney(headerDiscountKip * exchangeRate);
    const totalThb = roundMoney(totalKip * exchangeRate);
    const totalBeforeVatThb =
      SOK_VAT_TYPE === 2
        ? roundMoney(totalThb / (1 + SOK_VAT_RATE / 100))
        : totalThb;
    const totalVatThb = roundMoney(totalThb - totalBeforeVatThb);
    const headerDiscountWord =
      headerDiscountKip > 0 ? String(roundMoney(headerDiscountKip, 0)) : "";

      await tx.$executeRaw`
        INSERT INTO ic_trans (
          trans_type, trans_flag,
          doc_date, doc_no, doc_time,
          tax_doc_no, tax_doc_date,
          inquiry_type,
          cust_code,
          branch_code, department_code,
          wh_from, location_from,
          send_date, credit_date,
          currency_code, exchange_rate,
          total_value, total_value_2,
          total_discount, total_discount_2,
          discount_word, discount_word_2,
          total_before_vat, total_vat_value, total_after_vat,
          total_amount, total_amount_2, total_except_vat,
          balance_amount,
          vat_rate, vat_type,
          sum_point, sum_point_2,
          point_telephone, member_code,
          ar_point_balance, get_new_point,
          cashier_code, creator_code, sale_code,
          doc_format_code, sale_group,
          side_code,
          is_pos, status,
          is_cancel, cancel_type,
          create_datetime, lastedit_datetime,
          create_date_time_now,
          remark
        )
        VALUES (
          ${SOK_TRANS_TYPE}, ${SOK_TRANS_FLAG},
          CURRENT_DATE, ${sokDocNo}, to_char(NOW(), 'HH24:MI'),
          '', NULL,
          ${SOK_INQUIRY_TYPE},
          ${customerId},
          ${branchCode}, ${departmentCode},
          ${primaryWh}, ${defaultShelfCode},
          CURRENT_DATE, CURRENT_DATE,
          ${KIP_CURRENCY_CODE}, ${exchangeRate},
          ${headerValueThb}, ${headerValueKip},
          ${headerDiscountThb}, ${headerDiscountKip},
          ${headerDiscountWord}, ${headerDiscountWord},
          ${totalBeforeVatThb}, ${totalVatThb}, ${totalThb},
          ${totalThb}, ${totalKip}, 0,
          ${totalThb},
          ${SOK_VAT_RATE}, ${SOK_VAT_TYPE},
          ${earnedPoints}, 0,
          ${customerPhone}, ${customerId},
          ${customerPointBalance}, ${earnedPoints},
          ${userOwner}, ${userOwner}, ${userOwner},
          ${SOK_DOC_PREFIX}, ${SOK_SALE_GROUP},
          ${DEFAULT_SIDE_CODE},
          0, 0,
          0, 0,
          NOW(), NOW(),
          NOW(),
          ${remark}
        )
      `;

      // SML convention (from real CAK/INHPB samples):
      //   sum_amount/sum_amount_2 = NET (after the per-line discount)
      //   discount               = original input string, e.g. "3%"
      //   discount_amount        = per-line discount in THB
      //   discount_amount_2      = per-line discount in KIP
      // The member's standing discount is a per-line discount, so we record
      // it on every row — back-office reports filter by `discount`/_amount.
      // When a promotion also applies, both discounts are added together
      // and the label combines them, e.g. "3% + ໂປຣ ABC".
      const baseDiscountStr = discountPct > 0 ? `${discountPct}%` : "";
      for (let i = 0; i < linePricing.length; i++) {
        const pricing = linePricing[i];
        const item = pricing.item;
        const product = productMap.get(item.productId)!;
        const qty = item.quantity;
        const priceKip = pricing.price;
        const sumKip = pricing.amount;
        // Per-line salesperson override (POS sends it per cart line). Falls
        // back to the cart-level userOwner if absent, so legacy clients keep
        // working unchanged.
        const lineSaleCode =
          item.salespersonCode && item.salespersonCode.length > 0
            ? item.salespersonCode
            : userOwner;
        const priceThb = roundMoney(priceKip * exchangeRate, 4);
        const sumThb = roundMoney(sumKip * exchangeRate);
        const discountKip = pricing.customerDiscount + pricing.promoDiscount;
        const discountThb = roundMoney(discountKip * exchangeRate);
        const discountStr =
          [baseDiscountStr, pricing.promoLabel]
            .filter((s) => s && s.length > 0)
            .join(" + ") || "";
        const itemWh = (item.warehouseCode ?? "").trim() || primaryWh;
        const itemShelf =
          (item.locationCode ?? "").trim() || defaultShelfCode;
        await tx.$executeRaw`
          INSERT INTO ic_trans_detail (
            trans_type, trans_flag,
            doc_date, doc_no, doc_time,
            cust_code,
            inquiry_type,
            branch_code,
            item_code, item_name, unit_code,
            qty, price, sum_amount, total_qty,
            price_2, sum_amount_2,
            discount, discount_amount, discount_amount_2,
            wh_code, shelf_code,
            line_number,
            status, cancel_qty,
            stand_value, divide_value,
            calc_flag, item_type,
            vat_type,
            is_get_price,
            sum_amount_exclude_vat, price_exclude_vat,
            doc_date_calc, doc_time_calc,
            price_type,
            is_pos,
            currency_code, exchange_rate,
            department_code,
            creator_code, last_editor_code,
            create_datetime, lastedit_datetime,
            sale_code, sale_group,
            create_date_time_now
          )
          VALUES (
            ${SOK_TRANS_TYPE}, ${SOK_TRANS_FLAG},
            CURRENT_DATE, ${sokDocNo}, to_char(NOW(), 'HH24:MI'),
            ${customerId},
            ${SOK_INQUIRY_TYPE},
            ${branchCode},
            ${item.productId},
            ${product.name_1 ?? item.productId},
            ${orderUnitCode(product)},
            ${qty}, ${priceThb}, ${sumThb}, ${qty},
            ${priceKip}, ${sumKip},
            ${discountStr}, ${discountThb}, ${discountKip},
            ${itemWh}, ${itemShelf},
            ${i},
            0, 0,
            1, 1,
            ${SOK_CALC_FLAG}, ${SOK_ITEM_TYPE},
            ${SOK_VAT_TYPE},
            1,
            ${sumThb}, ${priceThb},
            CURRENT_DATE, to_char(NOW(), 'HH24:MI'),
            ${SOK_PRICE_TYPE},
            0,
            '', 0,
            ${departmentCode},
            ${userOwner}, ${userOwner},
            NOW(), NOW(),
            ${lineSaleCode}, ${SOK_SALE_GROUP},
            NOW()
          )
        `;
      }

    // Price requests — one row per requested override. We re-validate
    // serverside that the requested price is strictly lower than the stock
    // price (no upselling through approval), and that the productId is in
    // the cart so the request is actually meaningful.
    // cartNumber returned to clients and stored in app_* tables is the
    // post-prefix-and-year suffix of doc_no (MMSSSS = 6 chars). Matches
    // SUBSTRING(doc_no FROM 6) used throughout the read paths.
    const cartId = `${monthSuffix}${generated}`;
    // Cart-bound price requests are persisted with NULL requestedPrice —
    // the manager will fill the approved price in via PATCH at decision
    // time. We just need a row that points at (cart, item) plus the
    // requestor's reason.
    const cartProductIds = new Set(items.map((i) => i.productId));
    for (const pr of priceRequests) {
      if (!cartProductIds.has(pr.productId)) continue;
      const product = productMap.get(pr.productId);
      if (!product) continue;
      const originalPrice = product.sale_price_kip
        ? Number(product.sale_price_kip)
        : 0;
      if (originalPrice <= 0) continue;
      await tx.appPriceRequest.create({
        data: {
          cartNumber: cartId,
          itemCode: pr.productId,
          originalPrice,
          requestedPrice: null,
          requestorCode: employee.employeeCode ?? "",
          reason: pr.reason,
        },
      });
    }

    return cartId;
  });
      break;
    } catch (e) {
      if (attempt < 3 && isUniqueConstraintViolation(e)) {
        console.warn(
          `[orders] duplicate ic_trans doc_no while creating SOK; retrying (${attempt}/3)`,
        );
        continue;
      }
      throw e;
    }
  }
  if (!cartNumber) {
    return NextResponse.json(
      { error: "ສ້າງ Order ບໍ່ສຳເລັດ: ບໍ່ສາມາດສ້າງເລກເອກະສານໄດ້" },
      { status: 500 },
    );
  }

  // Notify managers if this order has any pending price requests. Fire and
  // forget — a push failure shouldn't fail the order. The mobile manager
  // also has the badge poll as a backup signal.
  if (priceRequests.length > 0) {
    notifyByRole("manager", {
      title: "ມີຄຳຂໍລາຄາພິເສດໃໝ່",
      body: `${employee.fullnameLo ?? employee.employeeCode ?? "ພະນັກງານ"} ສ້າງ Order #${cartNumber} (${priceRequests.length} ລາຍການລໍຖ້າອະນຸມັດ)`,
      data: {
        type: "price_request_new",
        cartNumber,
      },
    }).catch((e) => {
      console.warn("[notify] notifyByRole(manager) failed:", e);
    });
  }

  // Build the response straight from the SOK doc we just wrote. doc_no
  // suffix == cartNumber (MM + 4-digit seq) so we look the row up by exact
  // match. yearSuffix is captured from the same Date used to allocate.
  const yearSuffix2 = new Date().getFullYear().toString().slice(-2);
  const lookupDocNo = `SOK${yearSuffix2}${cartNumber}`;
  const createdRows = await prisma.$queryRaw<OrderRow[]>`
    SELECT
      ${cartNumber}::text AS id,
      t.doc_no,
      t.cust_code AS customer_id,
      ar.name_1 AS customer_name,
      ar.telephone AS customer_phone,
      t.status,
      (
        t.status = 1 AND EXISTS (
          SELECT 1 FROM odg_tms_detail w
          WHERE w.bill_no = t.tax_doc_no
        )
      ) AS is_scheduled,
      t.total_amount_2 AS total,
      COALESCE(t.sum_point, t.get_new_point, 0) AS earned_points,
      lc.earn_kip_per_point,
      lc.point_name,
      t.create_date_time_now AS created_at,
      NULLIF(t.sale_code, '') AS salesperson_code,
      emp.fullname_lo AS salesperson_name_lo,
      emp.fullname_en AS salesperson_name_en,
      emp.nickname AS salesperson_nickname,
      COALESCE(
        json_agg(
          json_build_object(
            'id', d.line_number,
            'productId', d.item_code,
            'quantity', d.qty,
            'unitPrice', d.price_2,
            'subtotal', d.sum_amount_2,
            'productName', p.name_1,
            'unitName', COALESCE(NULLIF(d.unit_code, ''), p.unit_standard_name),
            'whCode', NULLIF(d.wh_code, '')
          )
          ORDER BY d.line_number
        ) FILTER (WHERE d.line_number IS NOT NULL),
        '[]'::json
      ) AS items,
      t.wh_from AS warehouse_code
    FROM ic_trans t
    LEFT JOIN ar_customer ar ON ar.code = t.cust_code
    LEFT JOIN ic_trans_detail d
      ON d.doc_no = t.doc_no
      AND d.trans_type = t.trans_type
      AND d.trans_flag = t.trans_flag
    LEFT JOIN ic_inventory p ON p.code = d.item_code
    LEFT JOIN odg_employee emp ON emp.employee_code = NULLIF(t.sale_code, '')
    LEFT JOIN LATERAL (
      SELECT earn_kip_per_point, point_name
      FROM app_loyalty_config
      ORDER BY updated_at DESC
      LIMIT 1
    ) lc ON true
    WHERE t.doc_no = ${lookupDocNo}
      AND t.doc_format_code = 'SOK'
    GROUP BY
      t.doc_no,
      t.tax_doc_no,
      t.cust_code,
      ar.name_1,
      ar.telephone,
      t.status,
      t.total_amount_2,
      t.sum_point,
      t.get_new_point,
      lc.earn_kip_per_point,
      lc.point_name,
      t.create_date_time_now,
      t.sale_code,
      t.wh_from,
      emp.fullname_lo,
      emp.fullname_en,
      emp.nickname
    LIMIT 1
  `;

  return NextResponse.json(toOrder(createdRows[0]), { status: 201 });
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const e = error as {
      code?: unknown;
      meta?: { code?: unknown; message?: unknown; constraint?: unknown };
    };
    if (e.code === "P2002") return true;
    if (
      e.code === "P2010" &&
      (e.meta?.code === "23505" ||
        String(e.meta?.message ?? "").includes("23505") ||
        e.meta?.constraint === "ic_trans_ic_trans_pk_primary")
    ) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("23505") ||
    message.includes("ic_trans_ic_trans_pk_primary") ||
    message.includes("duplicate key value violates unique constraint")
  );
}
