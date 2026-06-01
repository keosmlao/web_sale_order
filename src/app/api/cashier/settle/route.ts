import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { notifyEmployees } from "@/lib/notify";
import {
  ACCEPTED_CURRENCIES,
  BILL_DISCOUNT_ITEM_CODE,
  BASE_CURRENCY,
  MAIN_CURRENCY,
  type CurrencyCode,
  type PayMethod,
} from "@/lib/payment";
import {
  applyPromotions,
  type EngineLine,
  type EnginePromotion,
} from "@/lib/promotions-engine";
import { STOCK_BALANCE_AS_OF_DATE } from "@/lib/inventory-config";

// Settlement: turn a draft order_cart into ic_trans + ic_trans_detail
// (inventory sale) and cb_trans (cash receipt).
//
// Currency handling (SML convention for KIP sales):
// - ic_trans.currency_code   = '02' (KIP)
// - ic_trans.exchange_rate   = current KIP→THB rate from erp_currency
// - ic_trans.total_amount    = THB equivalent (base currency)
// - ic_trans.total_amount_2  = KIP native amount
// - ic_trans_detail.price/sum_amount = stored in THB (base)
// - cb_trans amounts          = stored in THB (base)
//
// Doc convention:
// - doc_format_code = 'CAKAP'
// - doc_no          = 'CAKAP' + YY + MM + 4-digit sequence (e.g. CAKAP26050001)
// - trans_type      = 2 (sale)
// - trans_flag      = 44 (cash sale)
// - vat_type        = 0 (no VAT)
// - pay_type        = 1 (cash/mixed tender)

const DOC_PREFIX = "CAKAP";
const DEFAULT_SIDE_CODE = "200";

// Caps on attached transfer-slip uploads. Cashier UI is expected to compress
// phone-camera shots to JPEG before posting, so 1.5MB is plenty of headroom.
const MAX_SLIPS = 5;
const MAX_SLIP_BYTES = 1_500_000;
const ALLOWED_SLIP_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

type TransferSlipInput = {
  data: string;       // base64 (no data: prefix)
  mimeType: string;
  fileName?: string | null;
};

function parseSlips(input: unknown): TransferSlipInput[] {
  if (!Array.isArray(input)) return [];
  const slips: TransferSlipInput[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const data = typeof r.data === "string" ? r.data : "";
    const mimeType = typeof r.mimeType === "string" ? r.mimeType : "";
    const fileName = typeof r.fileName === "string" ? r.fileName : null;
    if (!data || !mimeType) continue;
    slips.push({ data, mimeType, fileName });
  }
  return slips;
}

type PaymentInput = {
  currency: CurrencyCode;
  method: PayMethod;
  amount: number; // native units, e.g. KIP or THB
};

type SettlementResult = {
  docNo: string;
  exchangeRate: number;
  lineSubtotalKip: number;
  billDiscountKip: number;
  redeemKipValue: number;
  redeemPointsApplied: number;
  promoKip: number;
  totalKip: number;
  totalThb: number;
  cashAmountKip: number;
  transferAmountKip: number;
  receivedAmountKip: number;
  cashAmountThb: number;
  transferAmountThb: number;
  receivedAmountThb: number;
  change: number;
  payments: Array<{
    currency: CurrencyCode;
    method: PayMethod;
    amount: number;
    rateToMain: number;
    amountInMain: number;
  }>;
  _salespersonCode: string | null;
};

// Accept either the new `payments` array form or the legacy
// `cashAmount`/`transferAmount` pair (which is implicitly LAK).
function parsePayments(body: {
  payments?: unknown;
  cashAmount?: unknown;
  transferAmount?: unknown;
}): PaymentInput[] {
  if (Array.isArray(body.payments)) {
    const out: PaymentInput[] = [];
    for (const raw of body.payments) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const currency = typeof r.currency === "string" ? r.currency.trim() : "";
      const method = typeof r.method === "string" ? r.method.trim() : "";
      const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
      if (!ACCEPTED_CURRENCIES.includes(currency as CurrencyCode)) continue;
      if (method !== "cash" && method !== "transfer") continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      out.push({
        currency: currency as CurrencyCode,
        method: method as PayMethod,
        amount,
      });
    }
    return out;
  }
  // Legacy fallback — treat the old fields as LAK.
  const out: PaymentInput[] = [];
  const cash = typeof body.cashAmount === "number" ? body.cashAmount : null;
  const transfer =
    typeof body.transferAmount === "number" ? body.transferAmount : null;
  if (cash && cash > 0) {
    out.push({ currency: MAIN_CURRENCY, method: "cash", amount: cash });
  }
  if (transfer && transfer > 0) {
    out.push({ currency: MAIN_CURRENCY, method: "transfer", amount: transfer });
  }
  return out;
}
const TRANS_TYPE = 2;
const TRANS_FLAG = 44;
const KIP_CURRENCY_CODE = MAIN_CURRENCY; // '02' — kept as alias for clarity in SML write paths
const VAT_TYPE = 2; // 2 = VAT inclusive (SML convention for CAK sales)
const VAT_RATE = 10; // 10% VAT
const PAY_TYPE = 1; // cash
const INQUIRY_TYPE = 1;
const SALE_GROUP = "WALKIN";
const ITEM_TYPE = 0;
const CALC_FLAG = -1;
const PRICE_TYPE = 2;

function roundMoney(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

type CartRow = {
  cart_number: string;
  doc_no: string;
  cust_code: string | null;
  amount: number | string | null;
  status: number | null;
  remark: string | null;
  sum_point: number | string | null;
  user_owner: string | null;
  header_department_code: string | null;
};

type CartItemRow = {
  roworder: number;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: number | string | null;
  price: number | string | null;
  amount: number | string | null;
  // Per-line member discount carried from SOK → CAKAP so the receipt and
  // SML reports preserve the customer's standing discount per row.
  discount: string | null;
  discount_amount: number | string | null;
  discount_amount_2: number | string | null;
  wh_code: string | null;
  shelf_code: string | null;
};

function yy(): string {
  return new Date().getFullYear().toString().slice(-2);
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າໃຊ້" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        cartNumber?: unknown;
        cashAmount?: unknown;
        transferAmount?: unknown;
        remark?: unknown;
        transferSlips?: unknown;
        payments?: unknown;
        billDiscountRequestId?: unknown;
        redeemPoints?: unknown;
      }
    | null;
  const cartNumber =
    typeof body?.cartNumber === "string" ? body.cartNumber.trim() : "";
  const remark =
    typeof body?.remark === "string" && body.remark.trim() !== ""
      ? body.remark.trim()
      : null;
  const transferSlips = parseSlips(body?.transferSlips);
  const payments = parsePayments(body ?? {});
  const billDiscountRequestIdRaw = body?.billDiscountRequestId;
  let billDiscountRequestId: bigint | null = null;
  if (
    typeof billDiscountRequestIdRaw === "string" &&
    billDiscountRequestIdRaw.trim()
  ) {
    try {
      billDiscountRequestId = BigInt(billDiscountRequestIdRaw.trim());
    } catch {
      return NextResponse.json(
        { error: "billDiscountRequestId ບໍ່ຖືກຕ້ອງ" },
        { status: 400 },
      );
    }
  }

  // Loyalty redemption: cashier passes how many points the (member) customer
  // is using to forgive part of the bill. Validated inside the txn against
  // the live ar_customer.point_balance + app_loyalty_config rate. Walk-in
  // sales (no customer) cannot redeem — guarded below.
  const redeemPointsRaw =
    typeof body?.redeemPoints === "number"
      ? body.redeemPoints
      : typeof body?.redeemPoints === "string"
        ? Number(body.redeemPoints)
        : 0;
  const redeemPoints =
    Number.isFinite(redeemPointsRaw) && redeemPointsRaw > 0
      ? Math.floor(redeemPointsRaw)
      : 0;

  if (!cartNumber) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸເລກກະຕ່າ" },
      { status: 400 },
    );
  }

  if (payments.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸການຮັບເງິນຢ່າງໜ້ອຍ 1 ລາຍການ" },
      { status: 400 },
    );
  }

  // When the cashier records any transfer (any currency), at least one slip
  // image is mandatory — the receipt-image is the audit trail for non-cash
  // money. Cash-only settlements do not require a slip.
  const hasAnyTransfer = payments.some((p) => p.method === "transfer");
  if (hasAnyTransfer && transferSlips.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາແນບຮູບສະລິບການໂອນເງິນຢ່າງໜ້ອຍ 1 ຮູບ" },
      { status: 400 },
    );
  }
  if (transferSlips.length > MAX_SLIPS) {
    return NextResponse.json(
      { error: `ແນບຮູບໄດ້ສູງສຸດ ${MAX_SLIPS} ຮູບເທົ່ານັ້ນ` },
      { status: 400 },
    );
  }

  // Decode + validate each slip up-front so we don't waste a DB transaction
  // on a payload we already know is bad.
  const decodedSlips: Array<{
    buffer: Buffer;
    mimeType: string;
    fileName: string | null;
    fileSize: number;
  }> = [];
  for (let i = 0; i < transferSlips.length; i++) {
    const s = transferSlips[i];
    if (!ALLOWED_SLIP_MIME.includes(s.mimeType.toLowerCase())) {
      return NextResponse.json(
        {
          error: `ຮູບລຳດັບທີ ${i + 1}: ໄຟລ໌ບໍ່ແມ່ນຮູບ (${s.mimeType}). ຮັບສະເພາະ JPG / PNG / WebP / HEIC`,
        },
        { status: 400 },
      );
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(s.data, "base64");
    } catch {
      return NextResponse.json(
        { error: `ຮູບລຳດັບທີ ${i + 1}: ຖອດລະຫັດບໍ່ສຳເລັດ` },
        { status: 400 },
      );
    }
    if (buffer.length === 0) {
      return NextResponse.json(
        { error: `ຮູບລຳດັບທີ ${i + 1}: ໄຟລ໌ວ່າງ` },
        { status: 400 },
      );
    }
    if (buffer.length > MAX_SLIP_BYTES) {
      return NextResponse.json(
        {
          error: `ຮູບລຳດັບທີ ${i + 1}: ຂະໜາດໃຫຍ່ກວ່າ ${Math.round(MAX_SLIP_BYTES / 1024)}KB`,
        },
        { status: 413 },
      );
    }
    decodedSlips.push({
      buffer,
      mimeType: s.mimeType.toLowerCase(),
      fileName: s.fileName?.slice(0, 200) ?? null,
      fileSize: buffer.length,
    });
  }

  const userCode = employee.employeeCode ?? "";
  const yearSuffix = yy();
  const monthSuffix = (new Date().getMonth() + 1)
    .toString()
    .padStart(2, "0");
  const yymm = `${yearSuffix}${monthSuffix}`;

  // Combine cashier remark with cart's delivery info and (optional) bill
  // discount + loyalty redemption notes into a single remark string.
  function joinRemarks(
    deliveryRemark: string | null,
    billDiscountKip: number,
    redeemKip = 0,
    redeemPts = 0,
  ): string | null {
    const parts: string[] = [];
    if (deliveryRemark && deliveryRemark.trim() !== "") {
      parts.push(`ຈັດສົ່ງ: ${deliveryRemark.trim()}`);
    }
    if (billDiscountKip > 0) {
      parts.push(
        `ສ່ວນຫຼຸດທ້າຍບິນ (ອະນຸມັດແລ້ວ): ${billDiscountKip.toLocaleString("en-US")}`,
      );
    }
    if (redeemKip > 0 && redeemPts > 0) {
      parts.push(
        `ແລກແຕ້ມ: ${redeemPts.toLocaleString("en-US")} ແຕ້ມ = ${redeemKip.toLocaleString("en-US")} ກີບ`,
      );
    }
    if (remark) parts.push(remark);
    return parts.length === 0 ? null : parts.join(" · ");
  }

  try {
    let result: SettlementResult | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await prisma.$transaction(async (tx): Promise<SettlementResult> => {
      // 1. Load the SOK doc and ensure it's still pending. cart_number is
      //    the 5-digit doc_no suffix; SUBSTRING(doc_no FROM 6) gives that.
      const cartRows = await tx.$queryRaw<CartRow[]>`
        SELECT
          SUBSTRING(doc_no FROM 6) AS cart_number,
          doc_no,
          cust_code,
          total_amount_2 AS amount,
          status,
          remark,
          sum_point,
          COALESCE(
            NULLIF(NULLIF(sale_code, ''), '00000'),
            NULLIF(NULLIF((
              SELECT d.sale_code
              FROM ic_trans_detail d
              WHERE d.doc_no = ic_trans.doc_no
                AND d.trans_type = ic_trans.trans_type
                AND d.trans_flag = ic_trans.trans_flag
              ORDER BY d.line_number
              LIMIT 1
            ), ''), '00000'),
            NULLIF(creator_code, '')
          ) AS user_owner,
          NULLIF(department_code, '') AS header_department_code
        FROM ic_trans
        WHERE doc_format_code = 'SOK'
          AND SUBSTRING(doc_no FROM 6) = ${cartNumber}
        ORDER BY create_date_time_now DESC
        LIMIT 1
        FOR UPDATE
      `;
      const cart = cartRows[0];
      if (!cart) {
        throw new HandledError(404, `ບໍ່ພົບກະຕ່າ ${cartNumber}`);
      }
      if ((cart.status ?? 0) !== 0) {
        throw new HandledError(
          409,
          `ກະຕ່າ ${cartNumber} ຖືກຮັບເງິນແລ້ວ`,
        );
      }
      // Walk-in support: cust_code may be NULL (no customer attached). The
      // SML columns are VARCHAR, so we coalesce to '' at every insert site;
      // ar_customer joins downstream skip the row when the code is blank.
      const custCode = cart.cust_code ?? "";
      // Loyalty points the SOK accrued at order time. Credited to the member
      // on settle and stamped onto the CAKAP header so a later void can claw
      // the exact same amount back.
      const earnedPts = Math.floor(Number(cart.sum_point ?? 0));

      // 2. Load items from the SOK doc.
      const items = await tx.$queryRaw<CartItemRow[]>`
        SELECT
          line_number AS roworder,
          item_code,
          unit_code,
          qty,
          price_2 AS price,
          sum_amount_2 AS amount,
          discount,
          discount_amount,
          discount_amount_2,
          wh_code,
          shelf_code,
          item_name
        FROM ic_trans_detail
        WHERE doc_no = ${cart.doc_no}
          AND trans_type = 2
        ORDER BY line_number
      `;
      if (items.length === 0) {
        throw new HandledError(400, `ກະຕ່າ ${cartNumber} ບໍ່ມີລາຍການສິນຄ້າ`);
      }

      // Real-time stock check. SML's balance function is the same one the
      // sales floor sees, so the cashier never settles a bill the warehouse
      // can no longer fulfill (e.g. another sale just consumed the unit).
      // Sums (item_code × wh_code) so multi-line same-item-same-wh sales
      // are validated against the combined demand.
      const stockDemand = new Map<string, { qty: number; itemName: string }>();
      for (const it of items) {
        const code = it.item_code;
        const wh = (it.wh_code ?? "").trim();
        const key = `${code}|${wh}`;
        const qty = it.qty ? Number(it.qty) : 0;
        const prev = stockDemand.get(key);
        if (prev) {
          prev.qty += qty;
        } else {
          stockDemand.set(key, { qty, itemName: it.item_name ?? code });
        }
      }
      const stockCodes = Array.from(
        new Set(items.map((it) => it.item_code)),
      ).filter(Boolean);
      const stockWarehouses = Array.from(
        new Set(items.map((it) => (it.wh_code ?? "").trim()).filter(Boolean)),
      );
      if (stockCodes.length > 0 && stockWarehouses.length > 0) {
        const balances = await tx.$queryRaw<
          Array<{
            ic_code: string | null;
            warehouse: string | null;
            balance_qty: string | number | null;
          }>
        >`
          SELECT ic_code, warehouse, SUM(balance_qty) AS balance_qty
          FROM public.sml_ic_function_stock_balance_warehouse_location(
            ${STOCK_BALANCE_AS_OF_DATE}::date,
            ${stockCodes.join(",")},
            ${stockWarehouses.join(",")},
            ''
          )
          GROUP BY ic_code, warehouse
        `;
        const stockMap = new Map<string, number>();
        for (const row of balances) {
          if (!row.ic_code || !row.warehouse) continue;
          stockMap.set(
            `${row.ic_code}|${row.warehouse}`,
            row.balance_qty ? Number(row.balance_qty) : 0,
          );
        }
        for (const [key, { qty, itemName }] of stockDemand) {
          const available = stockMap.get(key) ?? 0;
          if (available < qty) {
            const [code, wh] = key.split("|");
            throw new HandledError(
              409,
              `ສິນຄ້າ "${itemName}" (${code}) ໃນສາງ ${wh} ມີຍອດ ${available} ໜ່ວຍ ບໍ່ພໍຂາຍ ${qty} ໜ່ວຍ`,
            );
          }
        }
      }

      // Promotions audit. Run the same engine the SOK insertion used so we
      // can record on the receipt how much of the discount came from
      // active promos. We do not re-apply / mutate totals here — SOK has
      // already baked in promotions at order-creation time, and recomputing
      // would risk double-counting against discount_amount_2.
      const activePromos = await tx.$queryRaw<EnginePromotion[]>`
        SELECT
          id,
          name,
          promo_type        AS "promoType",
          is_active         AS "isActive",
          start_at          AS "startAt",
          end_at            AS "endAt",
          time_from         AS "timeFrom",
          time_to           AS "timeTo",
          trigger_item_code AS "triggerItemCode",
          trigger_qty       AS "triggerQty",
          bonus_item_code   AS "bonusItemCode",
          bonus_qty         AS "bonusQty",
          bonus_price_kip   AS "bonusPriceKip",
          fixed_price_kip   AS "fixedPriceKip"
        FROM app_promotion
        WHERE is_active = TRUE
          AND (start_at IS NULL OR start_at <= NOW())
          AND (end_at   IS NULL OR end_at   >= NOW())
      `;
      const engineLines: EngineLine[] = items.map((it) => {
        const qty = it.qty ? Number(it.qty) : 0;
        const price = it.price ? Number(it.price) : 0;
        const gross = qty * price;
        const customerDiscount = it.discount_amount_2
          ? Number(it.discount_amount_2)
          : 0;
        return {
          productId: it.item_code,
          quantity: qty,
          price,
          gross,
          customerDiscount,
          promoDiscount: 0,
          promoLabel: "",
          amount: Math.max(0, gross - customerDiscount),
        };
      });
      applyPromotions(engineLines, activePromos, new Date());
      const promoKip = engineLines.reduce(
        (s, l) => s + (l.promoDiscount || 0),
        0,
      );

      // 2a. Look up warehouse details — branch_code only. department_code
      // is owned by the salesperson, not the warehouse (so daily-sales
      // reports filter correctly per seller).
      const whCode = items[0].wh_code ?? "";
      const whRows = await tx.$queryRaw<
        Array<{
          code: string | null;
          branch_code: string | null;
        }>
      >`
        SELECT code, branch_code
        FROM ic_warehouse
        WHERE code = ${whCode}
        LIMIT 1
      `;
      const wh = whRows[0];
      // Branch defaults to '01' when ic_warehouse has no override — keeps
      // back-office reports filtering by branch consistent for the single-
      // branch deployments that don't bother setting branch_code.
      const branchCode = (wh?.branch_code ?? "").trim() || "01";

      // Resolve the salesperson code (from the SOK cart) and their
      // department. CAKAP must inherit the SOK's sale_code so the receipt
      // is credited to the salesperson who actually made the sale, not the
      // cashier who processed payment.
      const salespersonCode =
        (cart.user_owner ?? "").trim() || userCode;
      const empRows = await tx.$queryRaw<
        Array<{ department_code: string | null }>
      >`
        SELECT department_code
        FROM odg_employee
        WHERE employee_code = ${salespersonCode}
        LIMIT 1
      `;
      const departmentCode = (empRows[0]?.department_code ?? "").trim();
      const effectiveDepartmentCode =
        departmentCode || (cart.header_department_code ?? "").trim();

      // 2b. Look up default shelf for this warehouse (lowest code = primary
      // "ສະພາບດີ" shelf, e.g. 1102 → 110201). Used when order_item has no
      // explicit shelf_code.
      const shelfRows = await tx.$queryRaw<Array<{ code: string }>>`
        SELECT code
        FROM ic_shelf
        WHERE whcode = ${whCode}
        ORDER BY code
        LIMIT 1
      `;
      const defaultShelfCode = shelfRows[0]?.code ?? `${whCode}01`;

      // 2b. Load exchange rates for every currency we might receive in.
      // erp_currency stores rate-to-THB (the SML base) per row, so:
      //   exchangeRate(LAK) ≈ 0.0017  (1 KIP  ≈ 0.0017 THB)
      //   exchangeRate(THB) =  1      (THB is base; absent → assume 1)
      // For payment math we want rate-to-LAK (the main display currency),
      // derived as: rateToMain(C) = rateToBase(C) / rateToBase(LAK).
      const currenciesNeeded = Array.from(
        new Set<string>([
          ...payments.map((p) => p.currency),
          KIP_CURRENCY_CODE,
          BASE_CURRENCY,
        ]),
      );
      const rateRows = await tx.$queryRaw<
        Array<{ code: string; exchange_rate_present: string | number | null }>
      >`
        SELECT code, exchange_rate_present
        FROM erp_currency
        WHERE code IN (${Prisma.join(currenciesNeeded)})
      `;
      const rateToBase: Record<string, number> = {};
      for (const row of rateRows) {
        rateToBase[row.code] = row.exchange_rate_present
          ? Number(row.exchange_rate_present)
          : 0;
      }
      // THB has no row in some installations because it IS the base — fall
      // back to 1 so the math works.
      if (!rateToBase[BASE_CURRENCY]) rateToBase[BASE_CURRENCY] = 1;
      const lakToThb = rateToBase[KIP_CURRENCY_CODE] ?? 0;
      if (lakToThb <= 0) {
        throw new HandledError(
          500,
          "ຍັງບໍ່ໄດ້ຕັ້ງຄ່າອັດຕາແລກປ່ຽນເງິນກີບໃນ erp_currency",
        );
      }
      // Verify we have rates for every payment currency before doing math.
      for (const p of payments) {
        if (!(rateToBase[p.currency] > 0) && p.currency !== BASE_CURRENCY) {
          throw new HandledError(
            500,
            `ບໍ່ມີອັດຕາແລກປ່ຽນສຳລັບສະກຸນ ${p.currency} ໃນ erp_currency`,
          );
        }
      }
      // Convenience: "lakToThb" matches the legacy variable name used below
      // for the single-currency ic_trans header write.
      const exchangeRate = lakToThb;
      const rateToMain = (currency: string): number => {
        // rateToMain(LAK) = 1 by definition; for any other C, divide its
        // rate-to-base by LAK's rate-to-base.
        if (currency === KIP_CURRENCY_CODE) return 1;
        const r = rateToBase[currency] ?? 0;
        return r > 0 ? r / lakToThb : 0;
      };

      // 3. Generate next doc_no: CAKAP + YY + MM + 4-digit sequence.
      const docNoPattern = `${DOC_PREFIX}${yymm}%`;
      // Serialize doc number allocation per prefix/month. Without this,
      // two cashiers can read the same MAX(doc_no) concurrently and both try
      // to insert the same CAKAP number, hitting ic_trans primary-key 23505.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`${DOC_PREFIX}:${yymm}`}))
      `;
      // Derive the next sequence from BOTH ic_trans and app_settle_audit.
      // app_settle_audit carries its own UNIQUE(doc_no) and can outlive the
      // matching ic_trans row (e.g. SML resets the ic_* tables while the
      // app-owned audit persists). Counting only ic_trans would let the
      // allocator hand back a doc_no that already exists in app_settle_audit,
      // hitting app_settle_audit_doc_no_key at the step-12 insert.
      const seqRows = await tx.$queryRaw<Array<{ next_seq: number }>>`
        SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
        FROM (
          SELECT CAST(SUBSTRING(doc_no FROM ${DOC_PREFIX.length + 5}) AS INTEGER) AS seq
          FROM ic_trans
          WHERE doc_no LIKE ${docNoPattern}
            AND LENGTH(doc_no) >= ${DOC_PREFIX.length + 5}
          UNION ALL
          SELECT CAST(SUBSTRING(doc_no FROM ${DOC_PREFIX.length + 5}) AS INTEGER) AS seq
          FROM app_settle_audit
          WHERE doc_no LIKE ${docNoPattern}
            AND LENGTH(doc_no) >= ${DOC_PREFIX.length + 5}
        ) AS seqs
      `;
      let seq = seqRows[0]?.next_seq ?? 1;
      let docNo = `${DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
      let allocatedDocNo = false;
      for (let i = 0; i < 20; i++) {
        const existsRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
          SELECT (
            EXISTS (
              SELECT 1 FROM ic_trans
              WHERE doc_no = ${docNo}
                AND trans_flag = ${TRANS_FLAG}
            )
            OR EXISTS (
              SELECT 1 FROM app_settle_audit WHERE doc_no = ${docNo}
            )
          ) AS exists
        `;
        if (!existsRows[0]?.exists) {
          allocatedDocNo = true;
          break;
        }
        seq += 1;
        docNo = `${DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
      }
      if (!allocatedDocNo) {
        throw new HandledError(
          500,
          "ບໍ່ສາມາດຈອງເລກເອກະສານຮັບເງິນໄດ້",
        );
      }

      // Totals — KIP is the native currency the user sees; THB is the base
      // currency we store in ic_trans/ic_trans_detail/cb_trans.
      const lineSubtotalKip = items.reduce(
        (sum, it) => sum + (it.amount ? Number(it.amount) : 0),
        0,
      );

      // Bill-level discount (approved by a manager at receive time). If the
      // cashier passes billDiscountRequestId we verify the request matches
      // this cart, is still 'approved', and reduce totalKip accordingly.
      // The approved 'requestedPrice' is the bill total AFTER discount, so
      // discount = originalPrice − requestedPrice. We also require that the
      // request hasn't already been linked to another settled doc.
      let billDiscountKip = 0;
      let billDiscountReqRow: {
        id: bigint;
        original_price: string | number | null;
        requested_price: string | number | null;
      } | null = null;
      if (billDiscountRequestId !== null) {
        const reqRows = await tx.$queryRaw<
          Array<{
            id: bigint;
            cart_number: string | null;
            item_code: string;
            original_price: string | number | null;
            requested_price: string | number | null;
            status: string;
          }>
        >`
          SELECT id, cart_number, item_code, original_price, requested_price, status
          FROM app_price_request
          WHERE id = ${billDiscountRequestId}
          FOR UPDATE
        `;
        const req = reqRows[0];
        if (!req) {
          throw new HandledError(404, "ບໍ່ພົບຄຳຂໍສ່ວນຫຼຸດທ້າຍບິນ");
        }
        if (req.item_code !== BILL_DISCOUNT_ITEM_CODE) {
          throw new HandledError(
            400,
            "ຄຳຂໍບໍ່ແມ່ນສ່ວນຫຼຸດທ້າຍບິນ",
          );
        }
        if (req.cart_number !== cartNumber) {
          throw new HandledError(
            400,
            `ຄຳຂໍຜູກຕິດກັບກະຕ່າ ${req.cart_number ?? "(none)"}, ບໍ່ແມ່ນ ${cartNumber}`,
          );
        }
        if (req.status !== "approved") {
          throw new HandledError(
            400,
            `ຄຳຂໍສ່ວນຫຼຸດທ້າຍບິນຍັງບໍ່ໄດ້ອະນຸມັດ (ສະຖານະ: ${req.status})`,
          );
        }
        const orig = Number(req.original_price ?? 0);
        const after = Number(req.requested_price ?? 0);
        if (after >= orig || after <= 0) {
          throw new HandledError(
            500,
            "ຂໍ້ມູນຄຳຂໍສ່ວນຫຼຸດທ້າຍບິນຜິດປົກກະຕິ",
          );
        }
        billDiscountKip = orig - after;
        billDiscountReqRow = {
          id: req.id,
          original_price: req.original_price,
          requested_price: req.requested_price,
        };
      }

      // Loyalty redemption. Read the latest active config inside the txn so
      // the rate can't change mid-settle. Walk-in (no cust_code) cannot
      // redeem — no balance to deduct from. Redeem amount is capped by the
      // bill total after bill-discount so the customer never ends up with a
      // negative due.
      let redeemKipValue = 0;
      let redeemPointsApplied = 0;
      if (redeemPoints > 0) {
        if (!custCode) {
          throw new HandledError(
            400,
            "ການແລກແຕ້ມຕ້ອງມີລະຫັດລູກຄ້າ (ການຂາຍລູກຄ້າທົ່ວໄປແລກບໍ່ໄດ້)",
          );
        }
        const configRows = await tx.$queryRaw<
          Array<{
            redeem_points_per_kip: string | number | null;
            min_redeem_points: string | number | null;
            is_active: boolean | null;
          }>
        >`
          SELECT redeem_points_per_kip, min_redeem_points, is_active
          FROM app_loyalty_config
          WHERE is_active = TRUE
          ORDER BY updated_at DESC
          LIMIT 1
        `;
        const cfg = configRows[0];
        const redeemRate = cfg?.redeem_points_per_kip
          ? Number(cfg.redeem_points_per_kip)
          : 0;
        const minRedeem = cfg?.min_redeem_points
          ? Number(cfg.min_redeem_points)
          : 0;
        if (!cfg || cfg.is_active !== true || redeemRate <= 0) {
          throw new HandledError(
            400,
            "ການແລກແຕ້ມບໍ່ໄດ້ເປີດໃຊ້ (ກວດ /loyalty config)",
          );
        }
        if (redeemPoints < minRedeem) {
          throw new HandledError(
            400,
            `ຕ້ອງມີຢ່າງໜ້ອຍ ${minRedeem} ແຕ້ມຈິ່ງແລກໄດ້`,
          );
        }
        const balanceRows = await tx.$queryRaw<
          Array<{ point_balance: string | number | null }>
        >`
          SELECT point_balance FROM ar_customer WHERE code = ${custCode}
          FOR UPDATE
        `;
        const pointBalance = balanceRows[0]?.point_balance
          ? Number(balanceRows[0].point_balance)
          : 0;
        if (pointBalance < redeemPoints) {
          throw new HandledError(
            400,
            `ລູກຄ້າມີ ${pointBalance} ແຕ້ມ ບໍ່ພໍແລກ ${redeemPoints} ແຕ້ມ`,
          );
        }
        const billBeforeRedeem = Math.max(0, lineSubtotalKip - billDiscountKip);
        const requestedKip = roundMoney(redeemPoints / redeemRate);
        // Never let redemption exceed the bill — the leftover points stay
        // on the customer's balance for next time.
        if (requestedKip > billBeforeRedeem) {
          redeemKipValue = billBeforeRedeem;
          redeemPointsApplied = Math.floor(billBeforeRedeem * redeemRate);
        } else {
          redeemKipValue = requestedKip;
          redeemPointsApplied = redeemPoints;
        }
      }

      const totalKip = Math.max(
        0,
        lineSubtotalKip - billDiscountKip - redeemKipValue,
      );
      const totalThb = roundMoney(totalKip * exchangeRate);

      // Sum received money in LAK (main) and THB (base) across all payment
      // lines. amount_in_main is what the customer effectively gave us in
      // KIP terms — the cashier sees this on screen; total_amount_pay in
      // cb_trans is the same number converted to THB for SML compatibility.
      //
      // cb_trans header convention (verified against legacy CAK rows):
      //   cash_amount           = THB-cash payments only (currency=base)
      //   tranfer_amount        = THB-transfer payments only (currency=base)
      //   total_other_currency  = THB equivalent of foreign-currency payments
      //                           (KIP cash OR KIP transfer — SML's UI shows
      //                           this in the "ສະກຸນເງິນອື່ນ ໆ" field).
      // The per-line cash/transfer breakdown still lives in cb_trans_detail
      // (ref1 = 'cash' | 'transfer'), so no audit information is lost.
      let receivedInMain = 0;
      let cashAmountThb = 0;          // base-currency cash only
      let transferAmountThb = 0;      // base-currency transfer only
      let otherCurrencyThb = 0;       // THB equiv of all foreign-currency payments
      const paymentBreakdown: Array<{
        currency: CurrencyCode;
        method: PayMethod;
        amount: number;
        rateToMain: number;
        amountInMain: number;
      }> = [];
      for (const p of payments) {
        const toMain = rateToMain(p.currency);
        const toBase = rateToBase[p.currency] ?? 0;
        if (toMain <= 0 || toBase <= 0) {
          throw new HandledError(
            500,
            `ບໍ່ສາມາດແປງສະກຸນ ${p.currency} ໄດ້ (ບໍ່ມີອັດຕາແລກປ່ຽນ)`,
          );
        }
        const amountInMain = roundMoney(p.amount * toMain);
        receivedInMain += amountInMain;
        const amountInBase = roundMoney(p.amount * toBase);
        if (p.currency === BASE_CURRENCY) {
          if (p.method === "cash") cashAmountThb += amountInBase;
          else transferAmountThb += amountInBase;
        } else {
          otherCurrencyThb += amountInBase;
        }
        paymentBreakdown.push({
          currency: p.currency,
          method: p.method,
          amount: p.amount,
          rateToMain: toMain,
          amountInMain,
        });
      }
      receivedInMain = roundMoney(receivedInMain);
      cashAmountThb = roundMoney(cashAmountThb);
      transferAmountThb = roundMoney(transferAmountThb);
      otherCurrencyThb = roundMoney(otherCurrencyThb);
      const receivedAmountThb = roundMoney(
        cashAmountThb + transferAmountThb + otherCurrencyThb,
      );

      if (receivedInMain < totalKip) {
        throw new HandledError(
          400,
          `ຈຳນວນເງິນທີ່ຮັບບໍ່ພໍ (${receivedInMain} < ${totalKip})`,
        );
      }
      const changeAmountKip = roundMoney(receivedInMain - totalKip);
      const changeAmountThb = roundMoney(changeAmountKip * exchangeRate);
      // Legacy aliases kept for the existing ic_trans/cb_trans inserts below.
      const cashAmountKip = roundMoney(
        paymentBreakdown
          .filter((p) => p.method === "cash")
          .reduce((s, p) => s + p.amountInMain, 0),
      );
      const transferAmountKip = roundMoney(
        paymentBreakdown
          .filter((p) => p.method === "transfer")
          .reduce((s, p) => s + p.amountInMain, 0),
      );
      const receivedAmountKip = roundMoney(cashAmountKip + transferAmountKip);

      // 4. Insert ic_trans header — match SML CAK KIP convention.
      // total_value/total_amount in THB (base); total_value_2/total_amount_2 in KIP.
      // vat_type=2 (VAT inclusive); total_before_vat/total_vat_value left 0
      // as SML does for CAK records.
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
          total_before_vat, total_vat_value,
          total_amount, total_amount_2, total_except_vat,
          vat_rate, vat_type,
          cashier_code, creator_code, sale_code,
          doc_format_code, sale_group,
          side_code,
          is_pos, status,
          is_cancel, cancel_type,
          create_datetime, lastedit_datetime,
          create_date_time_now,
          sum_point,
          remark
        )
        VALUES (
          ${TRANS_TYPE}, ${TRANS_FLAG},
          CURRENT_DATE, ${docNo}, to_char(NOW(), 'HH24:MI'),
          ${docNo}, CURRENT_DATE,
          ${INQUIRY_TYPE},
          ${custCode},
          ${branchCode}, ${effectiveDepartmentCode},
          '', '',
          CURRENT_DATE, CURRENT_DATE,
          ${KIP_CURRENCY_CODE}, ${exchangeRate},
          ${totalThb}, ${totalKip},
          0, 0,
          ${totalThb}, ${totalKip}, 0,
          ${VAT_RATE}, ${VAT_TYPE},
          ${userCode}, ${userCode}, ${salespersonCode},
          ${DOC_PREFIX}, ${SALE_GROUP},
          ${DEFAULT_SIDE_CODE},
          0, 0,
          0, 0,
          NOW(), NOW(),
          NOW(),
          ${earnedPts},
          ${joinRemarks(cart.remark, billDiscountKip, redeemKipValue, redeemPointsApplied)}
        )
      `;

      // 5. Insert ic_trans_detail (one per item) — match SML KIP convention.
      // price/sum_amount in THB; price_2/sum_amount_2 in KIP.
      // *_exclude_vat mirrors the main amount (SML uses these even when VAT
      // is inclusive — they store the gross there too).
      //
      // Look up per-unit cost (in THB) for every item once, so each detail
      // row carries average_cost + sum_of_cost. Without these, ic_trans_detail
      // looks "empty" in the SML cost report and downstream WMS pipelines
      // can't compute margin per line.
      const itemCodes = Array.from(new Set(items.map((it) => it.item_code))).filter(Boolean);
      const costRows = itemCodes.length > 0
        ? await tx.$queryRaw<Array<{ code: string; average_cost: string | number | null }>>`
            SELECT code, average_cost
            FROM ic_inventory
            WHERE code IN (${Prisma.join(itemCodes)})
          `
        : [];
      const avgCostByCode = new Map<string, number>();
      for (const row of costRows) {
        avgCostByCode.set(
          row.code,
          row.average_cost ? Number(row.average_cost) : 0,
        );
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qty = it.qty ? Number(it.qty) : 0;
        const priceKip = it.price ? Number(it.price) : 0;
        const sumKip = it.amount ? Number(it.amount) : qty * priceKip;
        const priceThb = roundMoney(priceKip * exchangeRate, 4);
        const sumThb = roundMoney(sumKip * exchangeRate);
        // Carry per-line member discount through from the SOK row. KIP is
        // authoritative (recorded on SOK in KIP); THB is recomputed at the
        // current exchange rate so the cashier-time conversion wins.
        const discountStr = (it.discount ?? "").toString();
        const discountKip = it.discount_amount_2
          ? Number(it.discount_amount_2)
          : 0;
        const discountThb = roundMoney(discountKip * exchangeRate);
        const itemWh = (it.wh_code ?? "").trim() || whCode;
        const itemShelf =
          (it.shelf_code ?? "").trim() || defaultShelfCode;
        const avgCostThb = avgCostByCode.get(it.item_code) ?? 0;
        const sumOfCostThb = roundMoney(avgCostThb * qty);
        // set_ref_price = the original/list KIP unit price for the line.
        // Legacy CAK rows store the pre-discount KIP unit price here; for
        // our flow that's the same as price_2 (we don't carry a separate
        // "list" price independently of the sold price).
        const setRefPriceKip = priceKip;
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
            sale_code, sale_group,
            average_cost, average_cost_1,
            sum_of_cost, sum_of_cost_1,
            set_ref_price,
            create_date_time_now
          )
          VALUES (
            ${TRANS_TYPE}, ${TRANS_FLAG},
            CURRENT_DATE, ${docNo}, to_char(NOW(), 'HH24:MI'),
            ${custCode},
            ${INQUIRY_TYPE},
            ${branchCode},
            ${it.item_code},
            ${it.item_name ?? it.item_code},
            ${it.unit_code ?? ""},
            ${qty}, ${priceThb}, ${sumThb}, 0,
            ${priceKip}, ${sumKip},
            ${discountStr}, ${discountThb}, ${discountKip},
            ${itemWh}, ${itemShelf},
            ${i},
            0, 0,
            1, 1,
            ${CALC_FLAG}, ${ITEM_TYPE},
            ${VAT_TYPE},
            1,
            ${sumThb}, ${priceThb},
            CURRENT_DATE, to_char(NOW(), 'HH24:MI'),
            ${PRICE_TYPE},
            ${salespersonCode}, ${SALE_GROUP},
            ${avgCostThb}, ${avgCostThb},
            ${sumOfCostThb}, ${sumOfCostThb},
            ${setRefPriceKip},
            NOW()
          )
        `;
      }

      // 6. Insert cb_trans (cash/transfer receipt) — amounts in THB (base currency).
      // SML convention for foreign-currency sales: cb_trans.currency_code is
      // left empty and exchange_rate = 0; everything is stored in THB.
      await tx.$executeRaw`
        INSERT INTO cb_trans (
          trans_type, trans_flag,
          doc_date, doc_no, doc_time,
          ap_ar_code,
          branch_code,
          currency_code, exchange_rate,
          total_amount, total_net_amount,
          cash_amount, tranfer_amount,
          total_other_currency, total_other_currency_charge,
          total_amount_pay, pay_cash_amount,
          money_change,
          doc_format_code,
          pay_type,
          cashier_code,
          status,
          create_date_time_now,
          remark
        )
        VALUES (
          ${TRANS_TYPE}, ${TRANS_FLAG},
          CURRENT_DATE, ${docNo}, to_char(NOW(), 'HH24:MI'),
          ${custCode},
          ${branchCode},
          '', 0,
          ${totalThb}, ${totalThb},
          ${cashAmountThb}, ${transferAmountThb},
          ${otherCurrencyThb}, 0,
          ${receivedAmountThb}, 0,
          ${changeAmountThb},
          ${DOC_PREFIX},
          ${PAY_TYPE},
          ${userCode},
          0,
          NOW(),
          ${joinRemarks(cart.remark, billDiscountKip, redeemKipValue, redeemPointsApplied)}
        )
      `;

      // 6a. cb_trans_detail — one row per payment line, matching SML's
      // legacy POS convention exactly (verified against existing POS/CAK
      // rows in cb_trans_detail):
      //   amount          = native foreign amount (e.g. 979,700 KIP)
      //   amount_2        = 0  (NOT a duplicate of amount; SML expects 0)
      //   charge          = 0
      //   sum_amount      = base THB equivalent (= amount * exchange_rate).
      //                     This is what SML's UI displays as "ຍອດເງິນລວມ".
      //   sum_amount_2    = same as sum_amount when currency IS the base
      //                     (THB), else 0
      // Previous version wrote amount into amount_2 and the THB equivalent
      // into sum_amount_2 (instead of sum_amount), so SML showed an empty
      // "ຍອດເງິນລວມ" column on every CAKAP receipt.
      for (let i = 0; i < paymentBreakdown.length; i++) {
        const pb = paymentBreakdown[i];
        const payAmountThb = roundMoney(
          pb.amount * (rateToBase[pb.currency] ?? 1),
        );
        const sumAmount2 = pb.currency === BASE_CURRENCY ? payAmountThb : 0;
        await tx.$executeRaw`
          INSERT INTO cb_trans_detail (
            trans_type, trans_flag,
            doc_date, doc_no, doc_time,
            line_number,
            doc_type,
            trans_number,
            amount, amount_2, charge,
            sum_amount, sum_amount_2,
            currency_code, exchange_rate,
            ref1, ref2, remark,
            create_date_time_now
          )
          VALUES (
            ${TRANS_TYPE}, ${TRANS_FLAG},
            CURRENT_DATE, ${docNo}, to_char(NOW(), 'HH24:MI'),
            ${i},
            19,
            ${pb.currency},
            ${pb.amount}, 0, 0,
            ${payAmountThb}, ${sumAmount2},
            ${pb.currency}, ${rateToBase[pb.currency] ?? 1},
            ${pb.method}, ${pb.currency},
            ${pb.method === "cash" ? "cash" : "transfer"},
            NOW()
          )
        `;
      }

      // 6b. ic_trans_shipment — minimal shipment header pinned to the CAKAP
      // doc so the WMS/TMS pipelines can find the bill. Schema mirrors what
      // the WMS reader uses: (doc_no, trans_flag, doc_date, cust_code,
      // transport_name). transport_name carries the delivery hint the
      // salesperson captured at order time (parsed back out of remark).
      const deliveryHint = (() => {
        const r = cart.remark ?? "";
        const m = r.match(/ຈັດສົ່ງ:\s*([^·|]+)/);
        return m ? m[1].trim() : null;
      })();
      await tx.$executeRaw`
        INSERT INTO ic_trans_shipment (
          doc_no, trans_flag,
          doc_date,
          cust_code,
          transport_name
        )
        VALUES (
          ${docNo}, ${TRANS_FLAG},
          CURRENT_DATE,
          ${custCode},
          ${deliveryHint}
        )
      `;

      // 7. Save the per-(currency, method) payment breakdown. This is the
      // audit trail behind cb_trans.cash_amount / tranfer_amount — those are
      // aggregated and stored in THB for SML, but the app needs to know
      // exactly how much LAK cash vs. THB transfer the customer actually
      // gave us.
      for (const pb of paymentBreakdown) {
        await tx.$executeRaw`
          INSERT INTO app_payment_line (
            doc_no, cart_number,
            currency_code, pay_method,
            amount, exchange_rate_to_main, amount_in_main
          )
          VALUES (
            ${docNo}, ${cartNumber},
            ${pb.currency}, ${pb.method},
            ${pb.amount}, ${pb.rateToMain}, ${pb.amountInMain}
          )
        `;
      }

      // 8. Save attached transfer slips (one row per image). Inside the same
      // transaction so a settle either commits with all its slips or rolls
      // back together — never a half-settled order with missing proof.
      for (const slip of decodedSlips) {
        await tx.$executeRaw`
          INSERT INTO app_transfer_slip (
            doc_no, cart_number,
            image_data, mime_type, file_name, file_size,
            uploaded_by
          )
          VALUES (
            ${docNo}, ${cartNumber},
            ${slip.buffer}, ${slip.mimeType}, ${slip.fileName}, ${slip.fileSize},
            ${userCode}
          )
        `;
      }

      // 9. Mark the bill-discount request as 'used' so it can't be re-applied
      // to a different cart (defensive — cart_number is already pinned, but
      // this also gives the UI a clearer status when polling).
      if (billDiscountReqRow) {
        await tx.$executeRaw`
          UPDATE app_price_request
          SET status = 'used',
              approver_note = COALESCE(approver_note, '') ||
                CASE WHEN approver_note IS NULL OR approver_note = ''
                     THEN ${'ໃຊ້ໃນ ' + docNo}
                     ELSE ${' · ໃຊ້ໃນ ' + docNo}
                END
          WHERE id = ${billDiscountReqRow.id}
        `;
      }

      // 10. Mark the SOK doc settled (status=1) and pin the receipt's
      //     doc_no into tax_doc_no so downstream queries can derive the
      //     "ຈັດຖ້ຽວ" (SCHEDULED) state by joining odg_tms_detail.
      //     bill_no = SOK.tax_doc_no = CAKAP doc_no.
      await tx.$executeRaw`
        UPDATE ic_trans
        SET status = 1,
            tax_doc_no = ${docNo},
            lastedit_datetime = NOW()
        WHERE doc_no = ${cart.doc_no}
          AND doc_format_code = 'SOK'
      `;

      // 10a. Drop the hold sidecar row if this cart was parked. The hold
      //      state was a UI categorization; once settled, the bill is no
      //      longer "held" — clearing the row keeps the cashier list clean.
      await tx.$executeRaw`
        DELETE FROM app_held_cart WHERE cart_number = ${cartNumber}
      `;

      // 11. Loyalty redemption side-effects. Insert one history row and
      //     decrement the customer's point balance. Both happen inside
      //     the same txn as the settle so a rollback restores points.
      if (redeemPointsApplied > 0 && custCode) {
        await tx.$executeRaw`
          INSERT INTO app_loyalty_redemption (
            doc_no, cart_number, customer_code,
            points_used, kip_value, cashier_code
          )
          VALUES (
            ${docNo}, ${cartNumber}, ${custCode},
            ${redeemPointsApplied}, ${redeemKipValue}, ${userCode}
          )
        `;
        await tx.$executeRaw`
          UPDATE ar_customer
          SET point_balance = COALESCE(point_balance, 0) - ${redeemPointsApplied}
          WHERE code = ${custCode}
        `;
      }

      // 11b. Loyalty earning — credit the points this bill accrued (carried on
      //      the SOK header) to the member's balance. Stamped onto the CAKAP
      //      header above so voiding the receipt later subtracts the same
      //      amount. Walk-ins (no custCode) earn nothing.
      if (earnedPts > 0 && custCode) {
        await tx.$executeRaw`
          UPDATE ar_customer
          SET point_balance = COALESCE(point_balance, 0) + ${earnedPts}
          WHERE code = ${custCode}
        `;
      }

      // 12. Settle audit row — feeds shift X/Z report, receipt history
      //     search, and void/return flow. shift_id is bound to whatever
      //     shift the cashier currently has open (Phase F); NULL if no
      //     shift system is active.
      const openShiftRows = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM app_cashier_shift
        WHERE cashier_code = ${userCode} AND status = 'open'
        ORDER BY opened_at DESC
        LIMIT 1
      `;
      const shiftId = openShiftRows[0]?.id ?? null;
      await tx.$executeRaw`
        INSERT INTO app_settle_audit (
          doc_no, cart_number, shift_id, cashier_code,
          total_kip, cash_kip, transfer_kip,
          redeemed_kip, promo_kip
        )
        VALUES (
          ${docNo}, ${cartNumber}, ${shiftId}, ${userCode},
          ${totalKip}, ${cashAmountKip}, ${transferAmountKip},
          ${redeemKipValue}, ${promoKip}
        )
      `;

      return {
        docNo,
        exchangeRate,
        lineSubtotalKip,
        billDiscountKip,
        redeemKipValue,
        redeemPointsApplied,
        promoKip,
        totalKip,
        totalThb,
        cashAmountKip,
        transferAmountKip,
        receivedAmountKip,
        cashAmountThb,
        transferAmountThb,
        receivedAmountThb,
        change: changeAmountKip,
        payments: paymentBreakdown,
        // Internal-only: surface the salesperson code so the post-commit
        // FCM dispatch can reach them. Stripped before responding.
        _salespersonCode: cart.user_owner ?? null,
      };
    });
        break;
      } catch (e) {
        if (attempt < 3 && isUniqueConstraintViolation(e)) {
          console.warn(
            `[cashier/settle] duplicate ic_trans doc_no while settling ${cartNumber}; retrying (${attempt}/3)`,
          );
          continue;
        }
        throw e;
      }
    }
    if (!result) {
      throw new HandledError(500, "ຮັບເງິນບໍ່ສຳເລັດ: ບໍ່ສາມາດສ້າງເອກະສານໄດ້");
    }

    // Notify the salesperson who created the SOK that the cashier has now
    // settled it. We deliberately fire even when the cashier IS the
    // salesperson — that's a legitimate "in-the-field collect" workflow
    // and the salesperson still benefits from a confirmation toast on
    // their phone. Fire-and-forget: a push failure must not roll back
    // the receipt itself.
    const salespersonCode = result._salespersonCode;
    if (salespersonCode) {
      notifyEmployees([salespersonCode], {
        title: "ອໍເດີຖືກຮັບເງິນແລ້ວ ✓",
        body: `${result.docNo} · ${result.totalKip.toLocaleString("en-US")} ກີບ`,
        data: {
          type: "order_settled",
          cartNumber,
          docNo: result.docNo,
        },
      }).catch((e) => {
        console.warn("[notify] notifyEmployees(salesperson) settle failed:", e);
      });
    }

    // Strip the internal field before responding.
    const { _salespersonCode, ...publicResult } = result;
    void _salespersonCode;

    return NextResponse.json(publicResult, { status: 201 });
  } catch (e) {
    if (e instanceof HandledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

class HandledError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
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
