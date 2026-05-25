import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";

// Requestor input. The proposed price is intentionally absent — managers
// set the approved price at decision time. The requestor only declares
// the original price (for context) and a reason.
type CreateBody = {
  customerCode?: string;
  itemCode?: string;
  originalPrice?: number | string;
  reason?: string;
};

// POST /api/price-requests — standalone (cart-less) request.
// Salespeople use this from the dedicated "Price Request" menu BEFORE
// creating a sale order. The row sits with cart_number=NULL until either
// (a) a manager approves it and the next matching cart auto-applies it, or
// (b) it's rejected.
export async function POST(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!me.employeeCode) {
    return NextResponse.json(
      { error: "ບໍ່ມີ employeeCode ໃນ token" },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const customerCode = body.customerCode?.trim();
  const itemCode = body.itemCode?.trim();
  const originalPrice = Number(body.originalPrice);
  const reason = body.reason?.trim() ?? null;
  if (!customerCode || !itemCode) {
    return NextResponse.json(
      { error: "customerCode + itemCode ຕ້ອງມີ" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    return NextResponse.json(
      { error: "originalPrice ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "ກະລຸນາໃສ່ເຫດຜົນຂໍ" },
      { status: 400 },
    );
  }

  // requestedPrice stays NULL on create — the approver fills it in via
  // PATCH when they decide. This stops salespeople from "anchoring"
  // approvers to a number the requestor picked.
  const created = await prisma.appPriceRequest.create({
    data: {
      cartNumber: null,
      customerCode,
      itemCode,
      originalPrice: new Prisma.Decimal(originalPrice),
      requestedPrice: null,
      status: "pending",
      requestorCode: me.employeeCode,
      reason,
    },
  });

  return NextResponse.json({
    id: created.id.toString(),
    customerCode: created.customerCode,
    itemCode: created.itemCode,
    originalPrice: Number(created.originalPrice),
    requestedPrice: null,
    status: created.status,
    requestedAt: created.requestedAt,
  });
}

type Row = {
  id: bigint;
  cart_number: string | null;
  item_code: string;
  item_name: string | null;
  unit_name: string | null;
  qty: string | number | null;
  original_price: string | number | null;
  requested_price: string | number | null;
  status: string;
  requestor_code: string;
  requestor_name: string | null;
  reason: string | null;
  requested_at: Date;
  decided_at: Date | null;
  approver_code: string | null;
  approver_name: string | null;
  approver_note: string | null;
  customer_name: string | null;
  cart_amount: string | number | null;
};

// GET /api/price-requests?status=pending|approved|rejected|all
// Manager-only: lists price requests with all the context the approval UI
// needs in one round trip (item, customer, requestor names).
export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canApprovePriceRequests(roleFromEmployee(me))) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ເຫັນລາຍການອະນຸມັດ" },
      { status: 403 },
    );
  }
  const status = (request.nextUrl.searchParams.get("status") ?? "pending")
    .trim()
    .toLowerCase();
  const statusFilter = ["pending", "approved", "rejected"].includes(status)
    ? Prisma.sql`AND r.status = ${status}`
    : Prisma.empty;

  // Customer resolution: standalone requests carry customer_code on the row
  // itself; legacy cart-bound requests resolve customer through the cart.
  // COALESCE picks whichever join hit first.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      r.id,
      r.cart_number,
      r.item_code,
      p.name_1 AS item_name,
      p.unit_standard_name AS unit_name,
      oi.qty,
      r.original_price,
      r.requested_price,
      r.status,
      r.requestor_code,
      COALESCE(reqEmp.fullname_lo, reqEmp.nickname, r.requestor_code) AS requestor_name,
      r.reason,
      r.requested_at,
      r.decided_at,
      r.approver_code,
      COALESCE(appEmp.fullname_lo, appEmp.nickname, r.approver_code) AS approver_name,
      r.approver_note,
      COALESCE(arDirect.name_1, ar.name_1) AS customer_name,
      c.total_amount_2 AS cart_amount
    FROM app_price_request r
    LEFT JOIN ic_inventory p ON p.code = r.item_code
    LEFT JOIN ic_trans c
      ON c.doc_format_code = 'SOK'
     AND SUBSTRING(c.doc_no FROM 6) = r.cart_number
    LEFT JOIN ar_customer ar ON ar.code = c.cust_code
    LEFT JOIN ar_customer arDirect ON arDirect.code = r.customer_code
    LEFT JOIN odg_employee reqEmp ON reqEmp.employee_code = r.requestor_code
    LEFT JOIN odg_employee appEmp ON appEmp.employee_code = r.approver_code
    LEFT JOIN ic_trans_detail oi
      ON oi.doc_no = c.doc_no
     AND oi.trans_type = c.trans_type
     AND oi.trans_flag = c.trans_flag
     AND oi.item_code = r.item_code
    WHERE 1 = 1
      ${statusFilter}
    ORDER BY r.requested_at DESC
    LIMIT 200
  `;

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id.toString(),
      cartNumber: r.cart_number,
      itemCode: r.item_code,
      itemName: r.item_name,
      unitName: r.unit_name,
      qty: r.qty ? Number(r.qty) : 0,
      originalPrice: Number(r.original_price ?? 0),
      requestedPrice:
        r.requested_price !== null && r.requested_price !== undefined
          ? Number(r.requested_price)
          : null,
      status: r.status,
      requestorCode: r.requestor_code,
      requestorName: r.requestor_name,
      reason: r.reason,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      approverCode: r.approver_code,
      approverName: r.approver_name,
      approverNote: r.approver_note,
      customerName: r.customer_name,
      cartAmount: Number(r.cart_amount ?? 0),
    })),
  );
}
