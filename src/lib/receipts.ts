// Shared receipt-fetch logic used by both /api/cashier/receipts/[docNo]
// (drawer / mobile clients) and the server-rendered /cashier/receipts/[docNo]
// print page. Keeping this in one file means the JSON shape can't drift
// between the API and the page.
//
// Returns null when the doc_no is unknown so the caller can render a 404 or
// reply with the appropriate status without re-querying.

import { prisma } from "@/lib/prisma";

type HeaderRow = {
  doc_no: string;
  doc_date: Date | null;
  doc_time: string | null;
  create_date_time_now: Date | null;
  cust_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  sale_code: string | null;
  salesperson_name_lo: string | null;
  salesperson_nickname: string | null;
  cashier_code: string | null;
  cashier_name_lo: string | null;
  cashier_nickname: string | null;
  branch_code: string | null;
  department_code: string | null;
  total_amount: string | number | null;
  total_amount_2: string | number | null;
  total_discount: string | number | null;
  total_discount_2: string | number | null;
  discount_word: string | null;
  discount_word_2: string | null;
  exchange_rate: string | number | null;
  source_sok_doc_no: string | null;
  source: string | null;
  remark: string | null;
};

type ItemRow = {
  line_number: number;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string | number | null;
  price_2: string | number | null;
  sum_amount_2: string | number | null;
  discount: string | null;
  discount_amount: string | number | null;
  discount_amount_2: string | number | null;
};

type PaymentRow = {
  id: string;
  currency_code: string;
  pay_method: string;
  amount: string | number;
  exchange_rate_to_main: string | number;
  amount_in_main: string | number;
};

type SlipRow = {
  id: string;
  file_name: string | null;
  mime_type: string;
  file_size: number;
};

type CbTransRow = {
  cash_amount: string | number | null;
  tranfer_amount: string | number | null;
  total_amount_pay: string | number | null;
  money_change: string | number | null;
};

export type ReceiptDetail = {
  docNo: string;
  docDate: Date | null;
  docTime: string | null;
  createdAt: Date | null;
  customer: {
    code: string | null;
    name: string | null;
    phone: string | null;
    address: string | null;
  };
  salesperson: { code: string; name: string } | null;
  cashier: { code: string; name: string } | null;
  branchCode: string | null;
  departmentCode: string | null;
  sourceSokDocNo: string | null;
  // Channel that created the originating SOK order: 'web' | 'app' | null.
  source: string | null;
  totals: {
    amountThb: number;
    amountKip: number;
    billDiscountThb: number;
    billDiscountKip: number;
    billDiscountWord: string;
    billDiscountWordKip: string;
    exchangeRate: number;
  };
  cashSummary: {
    cashThb: number;
    transferThb: number;
    paidThb: number;
    changeThb: number;
  } | null;
  items: Array<{
    lineNumber: number;
    itemCode: string;
    itemName: string | null;
    unitCode: string | null;
    qty: number;
    priceKip: number;
    sumKip: number;
    discount: string;
    discountAmountThb: number;
    discountAmountKip: number;
  }>;
  payments: Array<{
    id: string;
    currencyCode: string;
    payMethod: string;
    amount: number;
    exchangeRateToMain: number;
    amountInMain: number;
  }>;
  slips: Array<{
    id: string;
    fileName: string | null;
    mimeType: string;
    fileSize: number;
  }>;
  remark: string | null;
};

export async function fetchReceipt(
  docNo: string,
): Promise<ReceiptDetail | null> {
  const headerRows = await prisma.$queryRaw<HeaderRow[]>`
    SELECT
      t.doc_no,
      t.doc_date,
      t.doc_time,
      t.create_date_time_now,
      t.cust_code,
      ar.name_1 AS customer_name,
      ar.telephone AS customer_phone,
      ar.address AS customer_address,
      NULLIF(t.sale_code, '') AS sale_code,
      sp.fullname_lo AS salesperson_name_lo,
      sp.nickname AS salesperson_nickname,
      NULLIF(t.cashier_code, '') AS cashier_code,
      ca.fullname_lo AS cashier_name_lo,
      ca.nickname AS cashier_nickname,
      NULLIF(t.branch_code, '') AS branch_code,
      NULLIF(t.department_code, '') AS department_code,
      t.total_amount,
      t.total_amount_2,
      t.total_discount,
      t.total_discount_2,
      t.discount_word,
      t.discount_word_2,
      t.exchange_rate,
      (
        SELECT s.doc_no FROM ic_trans s
        WHERE s.doc_format_code = 'SOK' AND s.tax_doc_no = t.doc_no
        LIMIT 1
      ) AS source_sok_doc_no,
      (
        SELECT aos.source
        FROM app_order_source aos
        JOIN ic_trans s2
          ON s2.doc_format_code = 'SOK' AND s2.tax_doc_no = t.doc_no
        WHERE aos.cart_number = SUBSTRING(s2.doc_no FROM 6)
        LIMIT 1
      ) AS source,
      t.remark
    FROM ic_trans t
    LEFT JOIN ar_customer ar ON ar.code = t.cust_code
    LEFT JOIN odg_employee sp ON sp.employee_code = NULLIF(t.sale_code, '')
    LEFT JOIN odg_employee ca ON ca.employee_code = NULLIF(t.cashier_code, '')
    WHERE t.doc_no = ${docNo}
      AND t.doc_format_code = 'CAKAP'
    LIMIT 1
  `;
  const header = headerRows[0];
  if (!header) return null;

  const [itemRows, paymentRows, slipRows, cbRows] = await Promise.all([
    prisma.$queryRaw<ItemRow[]>`
      SELECT
        line_number,
        item_code,
        item_name,
        unit_code,
        qty,
        price_2,
        sum_amount_2,
        discount,
        discount_amount,
        discount_amount_2
      FROM ic_trans_detail
      WHERE doc_no = ${docNo}
        AND trans_type = 2
      ORDER BY line_number
    `,
    prisma.$queryRaw<PaymentRow[]>`
      SELECT
        id::text AS id,
        currency_code,
        pay_method,
        amount,
        exchange_rate_to_main,
        amount_in_main
      FROM app_payment_line
      WHERE doc_no = ${docNo}
      ORDER BY id
    `,
    prisma.$queryRaw<SlipRow[]>`
      SELECT
        id::text AS id,
        file_name,
        mime_type,
        file_size
      FROM app_transfer_slip
      WHERE doc_no = ${docNo}
      ORDER BY id
    `,
    prisma.$queryRaw<CbTransRow[]>`
      SELECT cash_amount, tranfer_amount, total_amount_pay, money_change
      FROM cb_trans
      WHERE doc_no = ${docNo}
        AND doc_format_code = 'CAKAP'
      LIMIT 1
    `,
  ]);

  return {
    docNo: header.doc_no,
    docDate: header.doc_date,
    docTime: header.doc_time,
    createdAt: header.create_date_time_now,
    customer: {
      code: header.cust_code,
      name: header.customer_name,
      phone: header.customer_phone,
      address: header.customer_address,
    },
    salesperson: header.sale_code
      ? {
          code: header.sale_code,
          name:
            header.salesperson_name_lo?.trim() ||
            header.salesperson_nickname?.trim() ||
            header.sale_code,
        }
      : null,
    cashier: header.cashier_code
      ? {
          code: header.cashier_code,
          name:
            header.cashier_name_lo?.trim() ||
            header.cashier_nickname?.trim() ||
            header.cashier_code,
        }
      : null,
    branchCode: header.branch_code,
    departmentCode: header.department_code,
    sourceSokDocNo: header.source_sok_doc_no,
    source: header.source ?? null,
    totals: {
      amountThb: header.total_amount ? Number(header.total_amount) : 0,
      amountKip: header.total_amount_2 ? Number(header.total_amount_2) : 0,
      billDiscountThb: header.total_discount
        ? Number(header.total_discount)
        : 0,
      billDiscountKip: header.total_discount_2
        ? Number(header.total_discount_2)
        : 0,
      billDiscountWord: header.discount_word ?? "",
      billDiscountWordKip: header.discount_word_2 ?? "",
      exchangeRate: header.exchange_rate ? Number(header.exchange_rate) : 0,
    },
    cashSummary: cbRows[0]
      ? {
          cashThb: cbRows[0].cash_amount ? Number(cbRows[0].cash_amount) : 0,
          transferThb: cbRows[0].tranfer_amount
            ? Number(cbRows[0].tranfer_amount)
            : 0,
          paidThb: cbRows[0].total_amount_pay
            ? Number(cbRows[0].total_amount_pay)
            : 0,
          changeThb: cbRows[0].money_change
            ? Number(cbRows[0].money_change)
            : 0,
        }
      : null,
    items: itemRows.map((row) => ({
      lineNumber: row.line_number,
      itemCode: row.item_code,
      itemName: row.item_name,
      unitCode: row.unit_code,
      qty: row.qty ? Number(row.qty) : 0,
      priceKip: row.price_2 ? Number(row.price_2) : 0,
      sumKip: row.sum_amount_2 ? Number(row.sum_amount_2) : 0,
      discount: row.discount ?? "",
      discountAmountThb: row.discount_amount ? Number(row.discount_amount) : 0,
      discountAmountKip: row.discount_amount_2
        ? Number(row.discount_amount_2)
        : 0,
    })),
    payments: paymentRows.map((row) => ({
      id: row.id,
      currencyCode: row.currency_code,
      payMethod: row.pay_method,
      amount: Number(row.amount),
      exchangeRateToMain: Number(row.exchange_rate_to_main),
      amountInMain: Number(row.amount_in_main),
    })),
    slips: slipRows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
    })),
    remark: header.remark,
  };
}
