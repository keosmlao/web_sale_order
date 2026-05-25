import { requireEmployee } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseOrderRemark } from "@/lib/order-remark";
import {
  ACCEPTED_CURRENCIES,
  BASE_CURRENCY,
  MAIN_CURRENCY,
  type CurrencyCode,
} from "@/lib/payment";
import CashierClient from "./CashierClient";

export const dynamic ="force-dynamic";

type PriceRow = {
 id: bigint;
 cart_number: string | null;
 item_code: string;
 item_name: string | null;
 unit_name: string | null;
 customer_code: string | null;
 customer_name: string | null;
 original_price: string | number | null;
 requested_price: string | number | null;
 status: string;
 requestor_code: string;
 requestor_name: string | null;
 approver_code: string | null;
 approver_name: string | null;
 approver_note: string | null;
 reason: string | null;
 requested_at: Date;
 decided_at: Date | null;
};

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
 whName: string | null;
 shelfCode: string | null;
 shelfName: string | null;
 saleCode: string | null;
 salespersonName: string | null;
 setDetails: SetDetailJson[] | null;
};

type Row = {
 cart_number: string;
 doc_no: string;
 tax_doc_no: string | null;
 is_scheduled: boolean | null;
 is_held: boolean | null;
 user_owner: string | null;
 salesperson_name_lo: string | null;
 salesperson_nickname: string | null;
 cust_code: string | null;
 customer_name: string | null;
 customer_phone: string | null;
 amount: number | string | null;
 status: number | null;
 remark: string | null;
 create_date_time_now: Date;
 warehouse_code: string | null;
 warehouse_name: string | null;
 items: ItemJson[] | null;
};

type OrderStatusLabel =
 |"PENDING"
 |"COMPLETED"
 |"CANCELLED"
 |"SCHEDULED"
 |"HELD";

function statusLabel(
 status: number | null,
 isScheduled = false,
 isHeld = false,
): OrderStatusLabel {
 if (status === 2) return"CANCELLED";
 if (status === 1) return isScheduled ?"SCHEDULED" :"COMPLETED";
 if (isHeld) return"HELD";
 return"PENDING";
}

export default async function CashierPage() {
 await requireEmployee();

 const [rows, priceRows, rateRows] = await Promise.all([
 // Source is the SOK ic_trans doc (order_cart/order_item are no longer
 // written). cart_number is the 5-digit doc_no suffix.
 prisma.$queryRaw<Row[]>`
 SELECT
 SUBSTRING(t.doc_no FROM 6) AS cart_number,
 t.doc_no,
 NULLIF(t.tax_doc_no,'') AS tax_doc_no,
 (
 t.status = 1 AND EXISTS (
 SELECT 1 FROM odg_tms_detail w
 WHERE w.bill_no = t.tax_doc_no
 )
 ) AS is_scheduled,
 (
 t.status = 0 AND EXISTS (
 SELECT 1 FROM app_held_cart h
 WHERE h.doc_no = t.doc_no
 )
 ) AS is_held,
 COALESCE(
 NULLIF(NULLIF(t.sale_code,''),'00000'),
 NULLIF(NULLIF((
 SELECT d.sale_code
 FROM ic_trans_detail d
 WHERE d.doc_no = t.doc_no
 AND d.trans_type = t.trans_type
 AND d.trans_flag = t.trans_flag
 ORDER BY d.line_number
 LIMIT 1
 ),''),'00000'),
 NULLIF(t.creator_code,'')
 ) AS user_owner,
 emp.fullname_lo AS salesperson_name_lo,
 emp.nickname AS salesperson_nickname,
 t.cust_code,
 ar.name_1 AS customer_name,
 ar.telephone AS customer_phone,
 t.total_amount_2 AS amount,
 t.status,
 t.remark,
 t.create_date_time_now,
 COALESCE(
 NULLIF(t.wh_from,''),
 NULLIF((
 SELECT d.wh_code
 FROM ic_trans_detail d
 WHERE d.doc_no = t.doc_no
 AND d.trans_type = t.trans_type
 AND d.trans_flag = t.trans_flag
 ORDER BY d.line_number
 LIMIT 1
 ),'')
 ) AS warehouse_code,
 wh.name_1 AS warehouse_name,
 COALESCE(
 (
 SELECT json_agg(
 json_build_object(
'id', d.line_number,
'itemCode', d.item_code,
'itemName', d.item_name,
'unitCode', COALESCE(NULLIF(d.unit_code,''), p.unit_standard_name),
'qty', d.qty,
'price', d.price_2,
'amount', d.sum_amount_2,
'whCode', NULLIF(d.wh_code,''),
'whName', whD.name_1,
'shelfCode', NULLIF(d.shelf_code,''),
'shelfName', shD.name_1,
'saleCode', NULLIF(NULLIF(d.sale_code,''),'00000'),
'salespersonName', COALESCE(empD.fullname_lo, empD.nickname),
'setDetails', (
 SELECT json_agg(
 json_build_object(
'itemCode', sd.ic_code,
'itemName', sdi.name_1,
'unitCode', COALESCE(NULLIF(sd.unit_code,''), sdi.unit_standard_name),
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
 LEFT JOIN ic_warehouse whD ON whD.code = d.wh_code
 LEFT JOIN ic_shelf shD ON shD.whcode = d.wh_code AND shD.code = d.shelf_code
 LEFT JOIN odg_employee empD ON empD.employee_code = NULLIF(NULLIF(d.sale_code,''),'00000')
 WHERE d.doc_no = t.doc_no
 AND d.trans_type = t.trans_type
 AND d.trans_flag = t.trans_flag
 ),
'[]'::json
 ) AS items
 FROM ic_trans t
 LEFT JOIN ar_customer ar ON ar.code = t.cust_code
 LEFT JOIN odg_employee emp ON emp.employee_code = COALESCE(
 NULLIF(NULLIF(t.sale_code,''),'00000'),
 NULLIF(NULLIF((
 SELECT d.sale_code
 FROM ic_trans_detail d
 WHERE d.doc_no = t.doc_no
 AND d.trans_type = t.trans_type
 AND d.trans_flag = t.trans_flag
 ORDER BY d.line_number
 LIMIT 1
 ),''),'00000'),
 NULLIF(t.creator_code,'')
 )
 LEFT JOIN ic_warehouse wh ON wh.code = COALESCE(
 NULLIF(t.wh_from,''),
 NULLIF((
 SELECT d.wh_code
 FROM ic_trans_detail d
 WHERE d.doc_no = t.doc_no
 AND d.trans_type = t.trans_type
 AND d.trans_flag = t.trans_flag
 ORDER BY d.line_number
 LIMIT 1
 ),'')
 )
 WHERE t.doc_format_code = 'SOK'
 ORDER BY t.create_date_time_now DESC
 LIMIT 200
 `,
 // Approved special prices — visible to all roles in the cashier view so
 // staff can verify what's been approved before settling an order.
 prisma.$queryRaw<PriceRow[]>`
 SELECT
 r.id,
 r.cart_number,
 r.item_code,
 p.name_1 AS item_name,
 p.unit_standard_name AS unit_name,
 r.customer_code,
 COALESCE(arDirect.name_1, ar.name_1) AS customer_name,
 r.original_price,
 r.requested_price,
 r.status,
 r.requestor_code,
 COALESCE(reqEmp.fullname_lo, reqEmp.nickname, r.requestor_code) AS requestor_name,
 r.approver_code,
 COALESCE(appEmp.fullname_lo, appEmp.nickname, r.approver_code) AS approver_name,
 r.approver_note,
 r.reason,
 r.requested_at,
 r.decided_at
 FROM app_price_request r
 LEFT JOIN ic_inventory p ON p.code = r.item_code
 LEFT JOIN ic_trans c
   ON c.doc_format_code = 'SOK'
  AND SUBSTRING(c.doc_no FROM 6) = r.cart_number
 LEFT JOIN ar_customer ar ON ar.code = c.cust_code
 LEFT JOIN ar_customer arDirect ON arDirect.code = r.customer_code
 LEFT JOIN odg_employee reqEmp ON reqEmp.employee_code = r.requestor_code
 LEFT JOIN odg_employee appEmp ON appEmp.employee_code = r.approver_code
 WHERE r.status = 'approved'
 ORDER BY r.decided_at DESC NULLS LAST, r.requested_at DESC
 LIMIT 200
 `,
 // Current exchange rates for every currency the cashier UI may accept.
 // SettleForm reads these to compute live LAK equivalents as the user
 // types into per-currency fields. Rate is to-base (THB) per row.
 prisma.$queryRaw<Array<{ code: string; exchange_rate_present: string | number | null }>>`
 SELECT code, exchange_rate_present
 FROM erp_currency
 WHERE code IN (${Prisma.join(
 Array.from(new Set<string>([...ACCEPTED_CURRENCIES, BASE_CURRENCY])),
 )})
 `,
 ]);

 const pending = rows.map((r) => {
 const parsed = parseOrderRemark(r.remark);
 return {
 cartNumber: r.cart_number,
 // Full SOK doc_no, eg. "SOK26050001". tax_doc_no is seeded to
 // doc_no at SOK creation (SML header convention) and only diverges
 // once the cashier settles — treat that divergence as the signal
 // that a CAKAP receipt exists.
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
 statusLabel: statusLabel(r.status, r.is_scheduled === true, r.is_held === true),
 // Backwards-compat: pass parsed delivery only so old UI bindings keep
 // working but no longer show the packed discount/note blob.
 deliveryName: parsed.deliveryName,
 extraDiscount: parsed.extraDiscount,
 note: parsed.note,
 createdAt: r.create_date_time_now.toISOString(),
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
 whName: it.whName,
 shelfCode: it.shelfCode,
 shelfName: it.shelfName,
 saleCode: it.saleCode,
 salespersonName: it.salespersonName,
 setDetails: (it.setDetails ?? []).map((sd) => ({
 itemCode: sd.itemCode,
 itemName: sd.itemName,
 unitCode: sd.unitCode,
 quantity: sd.qty ? Number(sd.qty) : 0,
 })),
 })),
 };
 });

 const approvedPrices = priceRows.map((r) => {
 const original = Number(r.original_price ?? 0);
 const approved = Number(r.requested_price ?? 0);
 const savings = original > 0 ? ((original - approved) / original) * 100 : 0;
 return {
 id: r.id.toString(),
 cartNumber: r.cart_number,
 itemCode: r.item_code,
 itemName: r.item_name,
 unitName: r.unit_name,
 customerCode: r.customer_code,
 customerName: r.customer_name,
 originalPrice: original,
 approvedPrice: approved,
 savingsPct: savings,
 requestorCode: r.requestor_code,
 requestorName: r.requestor_name,
 approverCode: r.approver_code,
 approverName: r.approver_name,
 approverNote: r.approver_note,
 reason: r.reason,
 requestedAt: r.requested_at.toISOString(),
 decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
 };
 });

 // Convert erp_currency rows → rate-to-LAK map for SettleForm. The DB
 // stores rate-to-THB; the cashier UI thinks in LAK so we invert through
 // the LAK row. THB has no row in some installs → fall back to 1.
 const rateToBase: Record<string, number> = {};
 for (const r of rateRows) {
 if (!r.code) continue;
 const v = Number(r.exchange_rate_present ?? 0);
 if (v > 0) rateToBase[r.code] = v;
 }
 if (!rateToBase[BASE_CURRENCY]) rateToBase[BASE_CURRENCY] = 1;
 const lakToThb = rateToBase[MAIN_CURRENCY] ?? 0;
 const rateToMain: Record<CurrencyCode, number> = {} as Record<
 CurrencyCode,
 number
 >;
 for (const c of ACCEPTED_CURRENCIES) {
 if (c === MAIN_CURRENCY) {
 rateToMain[c] = 1;
 } else {
 const r = rateToBase[c] ?? 0;
 rateToMain[c] = lakToThb > 0 && r > 0 ? r / lakToThb : 0;
 }
 }

 return (
 <CashierClient
 initialOrders={pending}
 approvedPrices={approvedPrices}
 currencyRates={rateToMain}
 />
 );
}
