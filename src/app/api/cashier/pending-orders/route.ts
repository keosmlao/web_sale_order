import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { parseOrderRemark } from "@/lib/order-remark";

type SetDetailJson = {
  itemCode: string;
  itemName: string | null;
  unitCode: string | null;
  qty: number | string | null;
};

type ItemJson = {
  id: number;
  itemCode: string;
  itemName: string | null;
  unitCode: string | null;
  qty: number | string | null;
  price: number | string | null;
  amount: number | string | null;
  whCode: string | null;
  setDetails: SetDetailJson[] | null;
};

type PendingOrderRow = {
  cart_number: string;
  doc_no: string;
  user_owner: string | null;
  salesperson_name_lo: string | null;
  salesperson_nickname: string | null;
  cust_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number | string | null;
  status: number | null;
  is_scheduled: boolean | null;
  tax_doc_no: string | null;
  remark: string | null;
  create_date_time_now: Date;
  warehouse_code: string | null;
  warehouse_name: string | null;
  items: ItemJson[] | null;
};

type OrderStatusLabel =
  | "PENDING"
  | "COMPLETED"
  | "CANCELLED"
  | "SCHEDULED";

function statusLabel(
  status: number | null,
  isScheduled = false,
): OrderStatusLabel {
  if (status === 2) return "CANCELLED";
  if (status === 1) return isScheduled ? "SCHEDULED" : "COMPLETED";
  return "PENDING";
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Source is SML ic_trans (SOK) + ic_trans_detail now — order_cart and
  // order_item are no longer written. cart_number is the 5-digit doc_no
  // suffix that the cashier UI keys orders by.
  const rows = await prisma.$queryRaw<PendingOrderRow[]>`
    SELECT
      SUBSTRING(t.doc_no FROM 6) AS cart_number,
      t.doc_no,
      NULLIF(t.tax_doc_no, '') AS tax_doc_no,
      COALESCE(
        NULLIF(NULLIF(t.sale_code, ''), '00000'),
        NULLIF(NULLIF((
          SELECT d.sale_code
          FROM ic_trans_detail d
          WHERE d.doc_no = t.doc_no
            AND d.trans_type = t.trans_type
            AND d.trans_flag = t.trans_flag
          ORDER BY d.line_number
          LIMIT 1
        ), ''), '00000'),
        NULLIF(t.creator_code, '')
      ) AS user_owner,
      emp.fullname_lo AS salesperson_name_lo,
      emp.nickname AS salesperson_nickname,
      t.cust_code,
      ar.name_1 AS customer_name,
      ar.telephone AS customer_phone,
      t.total_amount_2 AS amount,
      t.status,
      (
        t.status = 1 AND EXISTS (
          SELECT 1 FROM odg_tms_detail w
          WHERE w.bill_no = t.tax_doc_no
        )
      ) AS is_scheduled,
      t.remark,
      t.create_date_time_now,
      COALESCE(
        NULLIF(t.wh_from, ''),
        NULLIF((
          SELECT d.wh_code
          FROM ic_trans_detail d
          WHERE d.doc_no = t.doc_no
            AND d.trans_type = t.trans_type
            AND d.trans_flag = t.trans_flag
          ORDER BY d.line_number
          LIMIT 1
        ), '')
      ) AS warehouse_code,
      wh.name_1 AS warehouse_name,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', d.line_number,
              'itemCode', d.item_code,
              'itemName', d.item_name,
              'unitCode', COALESCE(NULLIF(d.unit_code, ''), p.unit_standard_name),
              'qty', d.qty,
              'price', d.price_2,
              'amount', d.sum_amount_2,
              'whCode', NULLIF(d.wh_code, ''),
              'setDetails', (
                SELECT json_agg(
                  json_build_object(
                    'itemCode', sd.ic_code,
                    'itemName', sdi.name_1,
                    'unitCode', COALESCE(NULLIF(sd.unit_code, ''), sdi.unit_standard_name),
                    'qty', sd.qty
                  )
                  ORDER BY sd.line_number NULLS LAST, sd.roworder
                )
                FROM ic_inventory_set_detail sd
                LEFT JOIN ic_inventory sdi ON sdi.code = sd.ic_code
                WHERE sd.ic_set_code = d.item_code
                  AND COALESCE(sd.status, 0) <> 1
              )
            )
            ORDER BY d.line_number
          )
          FROM ic_trans_detail d
          LEFT JOIN ic_inventory p ON p.code = d.item_code
          WHERE d.doc_no = t.doc_no
            AND d.trans_type = t.trans_type
            AND d.trans_flag = t.trans_flag
        ),
        '[]'::json
      ) AS items
    FROM ic_trans t
    LEFT JOIN ar_customer ar ON ar.code = t.cust_code
    LEFT JOIN odg_employee emp ON emp.employee_code = COALESCE(
      NULLIF(NULLIF(t.sale_code, ''), '00000'),
      NULLIF(NULLIF((
        SELECT d.sale_code
        FROM ic_trans_detail d
        WHERE d.doc_no = t.doc_no
          AND d.trans_type = t.trans_type
          AND d.trans_flag = t.trans_flag
        ORDER BY d.line_number
        LIMIT 1
      ), ''), '00000'),
      NULLIF(t.creator_code, '')
    )
    LEFT JOIN ic_warehouse wh ON wh.code = COALESCE(
      NULLIF(t.wh_from, ''),
      NULLIF((
        SELECT d.wh_code
        FROM ic_trans_detail d
        WHERE d.doc_no = t.doc_no
          AND d.trans_type = t.trans_type
          AND d.trans_flag = t.trans_flag
        ORDER BY d.line_number
        LIMIT 1
      ), '')
    )
    WHERE t.doc_format_code = 'SOK'
    ORDER BY t.create_date_time_now DESC
    LIMIT 200
  `;

  return NextResponse.json(
    rows.map((r) => {
      const parsed = parseOrderRemark(r.remark);
      return {
        cartNumber: r.cart_number,
        // Full SOK doc_no (eg. SOK26050001) so the cashier sees the sale
        // order id as it appears in SML reports. tax_doc_no stays empty until
        // settlement writes the CAKAP receipt number there.
        docNo: r.doc_no,
        receiptDocNo:
          r.tax_doc_no && r.tax_doc_no !== r.doc_no ? r.tax_doc_no : null,
        userOwner: r.user_owner,
        salespersonName:
          r.salesperson_name_lo?.trim() ||
          r.salesperson_nickname?.trim() ||
          r.user_owner ||
          null,
        customerId: r.cust_code,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        totalAmount: r.amount ? Number(r.amount) : 0,
        statusCode: r.status ?? 0,
        statusLabel: statusLabel(r.status, r.is_scheduled === true),
        // Backwards-compat: deliveryName remains the parsed delivery only, so
        // existing UI bindings keep working but no longer show the packed
        // discount/note blob.
        deliveryName: parsed.deliveryName,
        extraDiscount: parsed.extraDiscount,
        note: parsed.note,
        rawRemark: r.remark,
        createdAt: r.create_date_time_now,
        warehouseCode: r.warehouse_code,
        warehouseName: r.warehouse_name,
        items: (r.items ?? []).map((it) => ({
          id: String(it.id),
          itemCode: it.itemCode,
          itemName: it.itemName,
          unitCode: it.unitCode,
          quantity: it.qty ? Number(it.qty) : 0,
          unitPrice: it.price ? Number(it.price) : 0,
          amount: it.amount ? Number(it.amount) : 0,
          whCode: it.whCode,
          setDetails: (it.setDetails ?? []).map((sd) => ({
            itemCode: sd.itemCode,
            itemName: sd.itemName,
            unitCode: sd.unitCode,
            quantity: sd.qty ? Number(sd.qty) : 0,
          })),
        })),
      };
    }),
  );
}
