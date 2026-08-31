import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest, verifyPassword } from "@/lib/auth";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";

// /api/cashier/void — issue a return document (CTPL) for a settled CAKAP
// receipt and reverse the original transaction's side-effects (stock,
// loyalty, settle audit). Requires manager PIN (or login password fallback)
// from a role that can approve price requests.
//
// Body: { docNo, reason, managerCode, managerPin }
//
// Doc convention — SML's own sale-return shape, verified against the live
// data rather than guessed:
//   doc_format_code = 'CTPL'
//   doc_no          = 'CTPL' + YY + MM + 4-digit seq (advisory lock)
//   doc_ref         = the bill being returned. ic_trans has no ref_doc_no
//                     column — doc_ref/doc_ref_date is where SML puts it, as
//                     its own CN* returns show.
//   trans_type      = 2, trans_flag = 48 (ບິນຮັບຄືນ). Every one of the 1,395
//                     returns SML raised in 2026 is (2, 48); trans_flag 46
//                     does not appear in the data at all, and the chatbot
//                     trigger maps 48 → 'ບິນຮັບຄືນ'.
//   amounts         = POSITIVE, on ic_trans, ic_trans_detail and cb_trans
//                     alike (0 of 1,395 headers and 0 of 874 cashbook rows
//                     are negative). The trans_flag is what marks it a
//                     return; the ETL into odg_sale_detail is what flips the
//                     sign for reporting.
//   calc_flag       = +1 on every detail row, against the sale's -1.
//
// Those last two are not cosmetic. The stock balance function reads
//   SUM(calc_flag * qty * stand_value/divide_value)
// over rows with last_status = 0 and doc_date_calc <= the as-of date. A
// return that leaves calc_flag, stand_value, divide_value and doc_date_calc
// to their column defaults (0, 0.0, 0.0, NULL) contributes nothing at all —
// it is filtered out by doc_date_calc before the arithmetic even runs. That
// is why voided bills never put their goods back on the shelf.

const DOC_PREFIX = "CTPL";
const RETURN_TRANS_TYPE = 2;
const RETURN_TRANS_FLAG = 48;
// Sales are written with calc_flag -1 (stock out); returns with +1 (stock in).
const RETURN_CALC_FLAG = 1;
// Mirrors the CAKAP sale: cash doc, VAT-inclusive, normal stock item. The
// stock function only counts flag-48 rows whose inquiry_type < 2.
const INQUIRY_TYPE = 1;
const VAT_TYPE = 2;
const ITEM_TYPE = 0;
const PRICE_TYPE = 2;
const SALE_GROUP = "WALKIN";
// check_side_isnull raises on any trans_flag 44/48 header outside the
// CAK/INK/CAP/INP formats that arrives with a NULL side_code or
// department_code. CTPL is outside that list, so the return has to carry one.
const DEFAULT_SIDE_CODE = "200";

type CakRow = {
  doc_no: string;
  cart_number: string;
  cust_code: string | null;
  branch_code: string | null;
  department_code: string | null;
  currency_code: string | null;
  exchange_rate: string | number | null;
  total_amount: string | number | null;
  total_amount_2: string | number | null;
  cashier_code: string | null;
  sale_code: string | null;
  side_code: string | null;
  status: number | null;
  sum_point: string | number | null;
};

type CakDetailRow = {
  line_number: number;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string | number | null;
  price: string | number | null;
  price_2: string | number | null;
  sum_amount: string | number | null;
  sum_amount_2: string | number | null;
  discount_amount: string | number | null;
  discount_amount_2: string | number | null;
  wh_code: string | null;
  shelf_code: string | null;
  average_cost: string | number | null;
  sum_of_cost: string | number | null;
  sale_code: string | null;
  sale_group: string | null;
  set_ref_price: string | number | null;
  stand_value: string | number | null;
  divide_value: string | number | null;
};

type CbHeaderRow = {
  cash_amount: string | number | null;
  tranfer_amount: string | number | null;
  total_other_currency: string | number | null;
  total_amount: string | number | null;
  total_amount_pay: string | number | null;
};

type SettleAuditRow = {
  redeemed_kip: string | number | null;
  is_voided: boolean | null;
  // The SOK cart this receipt came from. CakRow.cart_number is a substring of
  // the CAKAP doc_no and is NOT the cart number — 'CAKAP26080003' yields
  // '26080003', not the SOK's '089901'. Anything that has to find the cart
  // again reads it from here, where settle recorded the real one.
  cart_number: string | null;
};

type RedemptionRow = {
  points_used: number;
  customer_code: string;
};

type ManagerRow = {
  employee_code: string | null;
  pos_pin_hash: string | null;
  password: string | null;
  app_role: string | null;
  position_code: string | null;
};

export async function POST(request: NextRequest) {
  const cashier = await getEmployeeFromRequest(request);
  if (!cashier) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    docNo?: unknown;
    reason?: unknown;
    managerCode?: unknown;
    managerPin?: unknown;
    // Partial return: which lines come back, and how many of each.
    // Absent → the classic full void.
    lines?: Array<{ lineNumber?: unknown; qty?: unknown }>;
  } | null;
  const docNo = typeof body?.docNo === "string" ? body.docNo.trim() : "";
  const reason =
    typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  const managerCode =
    typeof body?.managerCode === "string" ? body.managerCode.trim() : "";
  const managerPin =
    typeof body?.managerPin === "string" ? body.managerPin : "";

  const requestedLines: Array<{ lineNumber: number; qty: number }> = [];
  if (Array.isArray(body?.lines)) {
    for (const l of body.lines) {
      const lineNumber = Number(l?.lineNumber);
      const qty = Number(l?.qty);
      if (!Number.isInteger(lineNumber) || !(qty > 0)) {
        return NextResponse.json(
          { error: "ລາຍການຄືນບໍ່ຖືກຕ້ອງ" },
          { status: 400 },
        );
      }
      requestedLines.push({ lineNumber, qty });
    }
  }
  // Partial mode the moment lines are named: the original bill stays
  // alive, only the named goods and their money come back.
  const partial = requestedLines.length > 0;

  if (!docNo) {
    return NextResponse.json({ error: "docNo required" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json(
      { error: "ກະລຸນາໃສ່ເຫດຜົນຍົກເລີກ" },
      { status: 400 },
    );
  }
  if (!managerCode || !managerPin) {
    return NextResponse.json(
      { error: "ໃສ່ລະຫັດ ແລະ PIN ຂອງຜູ້ຈັດການ" },
      { status: 400 },
    );
  }

  // Verify manager PIN.
  const mgrRows = await prisma.$queryRaw<ManagerRow[]>`
    SELECT employee_code, pos_pin_hash, password, app_role, position_code
    FROM odg_employee
    WHERE employee_code = ${managerCode}
    LIMIT 1
  `;
  const mgr = mgrRows[0];
  if (!mgr) {
    return NextResponse.json(
      { error: "ບໍ່ພົບລະຫັດຜູ້ຈັດການ" },
      { status: 403 },
    );
  }
  const pinOk = mgr.pos_pin_hash
    ? await verifyPassword(mgr.pos_pin_hash, managerPin)
    : await verifyPassword(mgr.password, managerPin);
  if (!pinOk) {
    return NextResponse.json({ error: "PIN ບໍ່ຖືກຕ້ອງ" }, { status: 403 });
  }
  const role = roleFromEmployee({
    appRole: mgr.app_role,
    positionCode: mgr.position_code,
  });
  if (!canApprovePriceRequests(role)) {
    return NextResponse.json(
      { error: "ບໍ່ໃຫ້ສິດຍົກເລີກບິນ — ຕ້ອງເປັນ Manager" },
      { status: 403 },
    );
  }

  const userCode = cashier.employeeCode ?? "";

  try {
    const voidDocNo = await prisma.$transaction(async (tx) => {
      // 1. Lock + load the original CAKAP.
      const cakRows = await tx.$queryRaw<CakRow[]>`
        SELECT
          doc_no,
          SUBSTRING(doc_no FROM 6) AS cart_number,
          cust_code,
          branch_code, department_code,
          currency_code, exchange_rate,
          total_amount, total_amount_2,
          cashier_code, sale_code, side_code,
          status,
          sum_point
        FROM ic_trans
        WHERE doc_no = ${docNo} AND doc_format_code = 'CAKAP'
        FOR UPDATE
      `;
      const cak = cakRows[0];
      if (!cak) {
        throw new HandledError(404, `ບໍ່ພົບໃບຮັບ ${docNo}`);
      }
      if ((cak.status ?? 0) === 2) {
        throw new HandledError(409, `ໃບຮັບ ${docNo} ຖືກຍົກເລີກແລ້ວ`);
      }

      // 2. Guard against double-void via app_settle_audit. The settle row
      //    is also where we record the CTPL number, so this also confirms
      //    the receipt was settled through the in-app flow.
      const auditRows = await tx.$queryRaw<SettleAuditRow[]>`
        SELECT redeemed_kip, is_voided, cart_number FROM app_settle_audit
        WHERE doc_no = ${docNo}
        FOR UPDATE
      `;
      const audit = auditRows[0];
      if (audit?.is_voided === true) {
        throw new HandledError(409, `ໃບຮັບ ${docNo} ຖືກຍົກເລີກແລ້ວ`);
      }

      // 3. Load every detail line so we can copy them onto the CTPL
      //    (preserves price columns for SML reports).
      const details = await tx.$queryRaw<CakDetailRow[]>`
        SELECT
          line_number, item_code, item_name, unit_code,
          qty, price, price_2, sum_amount, sum_amount_2,
          discount_amount, discount_amount_2,
          wh_code, shelf_code,
          average_cost, sum_of_cost,
          sale_code, sale_group, set_ref_price,
          stand_value, divide_value
        FROM ic_trans_detail
        WHERE doc_no = ${docNo} AND trans_type = 2
        ORDER BY line_number
      `;
      if (details.length === 0) {
        throw new HandledError(500, "ໃບຮັບບໍ່ມີລາຍການສິນຄ້າ");
      }

      // Partial return: scale each named line down to the returned
      // quantity. Prior CTPLs against this receipt are netted off first so
      // a line can never come back more times than it was sold.
      let docLines = details;
      let partialKip = 0;
      let partialThb = 0;
      if (partial) {
        const priorRows = await tx.$queryRaw<
          Array<{ line_number: number; returned: string | number | null }>
        >`
          SELECT d.line_number, SUM(d.qty) AS returned
          FROM ic_trans_detail d
          JOIN ic_trans h
            ON h.doc_no = d.doc_no
           AND h.doc_format_code = ${DOC_PREFIX}
           AND h.doc_ref = ${docNo}
          WHERE d.trans_flag = ${RETURN_TRANS_FLAG}
          GROUP BY d.line_number
        `;
        const priorByLine = new Map(
          priorRows.map((r) => [r.line_number, Number(r.returned ?? 0)]),
        );
        const byLine = new Map(details.map((d) => [d.line_number, d]));
        const scaled: CakDetailRow[] = [];
        for (const req of requestedLines) {
          const d = byLine.get(req.lineNumber);
          if (!d) {
            throw new HandledError(400, `ບໍ່ພົບແຖວ ${req.lineNumber} ໃນບິນ`);
          }
          const sold = Number(d.qty ?? 0);
          const already = priorByLine.get(req.lineNumber) ?? 0;
          if (req.qty > sold - already + 1e-9) {
            throw new HandledError(
              409,
              `${d.item_code}: ຄືນໄດ້ສູງສຸດ ${sold - already} (ຂາຍ ${sold}, ຄືນແລ້ວ ${already})`,
            );
          }
          const factor = req.qty / sold;
          const round2 = (v: number) => Math.round(v * 100) / 100;
          scaled.push({
            ...d,
            qty: req.qty,
            sum_amount: round2(Number(d.sum_amount ?? 0) * factor),
            sum_amount_2: round2(Number(d.sum_amount_2 ?? 0) * factor),
            discount_amount: round2(Number(d.discount_amount ?? 0) * factor),
            discount_amount_2: round2(
              Number(d.discount_amount_2 ?? 0) * factor,
            ),
            sum_of_cost: round2(Number(d.sum_of_cost ?? 0) * factor),
          });
        }
        docLines = scaled;
        partialKip = scaled.reduce(
          (a, d) => a + Number(d.sum_amount_2 ?? 0),
          0,
        );
        partialThb = scaled.reduce((a, d) => a + Number(d.sum_amount ?? 0), 0);
      }

      // 4. Snapshot cb_trans for the refund header.
      const cbRows = await tx.$queryRaw<CbHeaderRow[]>`
        SELECT cash_amount, tranfer_amount, total_other_currency,
               total_amount, total_amount_pay
        FROM cb_trans
        WHERE doc_no = ${docNo}
        LIMIT 1
      `;
      const cb = cbRows[0];

      // 5. Allocate CTPL doc_no with advisory lock. YYMM comes from Postgres,
      //    the same clock that stamps doc_date below — taking it from the web
      //    server instead puts the document in the wrong monthly series
      //    whenever the two disagree about what day it is.
      const yymmRows = await tx.$queryRaw<Array<{ yymm: string }>>`
        SELECT to_char(CURRENT_DATE, 'YYMM') AS yymm
      `;
      const yymm = yymmRows[0]?.yymm ?? "";
      if (yymm.length !== 4) {
        throw new HandledError(500, "ບໍ່ສາມາດອ່ານປີ/ເດືອນຈາກຖານຂໍ້ມູນໄດ້");
      }
      const docNoPattern = `${DOC_PREFIX}${yymm}%`;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`${DOC_PREFIX}:${yymm}`}))
      `;
      const seqRows = await tx.$queryRaw<Array<{ next_seq: number }>>`
        SELECT COALESCE(
          MAX(CAST(SUBSTRING(doc_no FROM ${DOC_PREFIX.length + 5}) AS INTEGER)),
          0
        ) + 1 AS next_seq
        FROM ic_trans
        WHERE doc_no LIKE ${docNoPattern}
          AND LENGTH(doc_no) >= ${DOC_PREFIX.length + 5}
      `;
      let seq = seqRows[0]?.next_seq ?? 1;
      let newDocNo = `${DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
      let allocatedDocNo = false;
      for (let i = 0; i < 20; i++) {
        const existsRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM ic_trans WHERE doc_no = ${newDocNo}
          ) AS exists
        `;
        if (!existsRows[0]?.exists) {
          allocatedDocNo = true;
          break;
        }
        seq += 1;
        newDocNo = `${DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
      }
      // Falling out of that loop still holding a taken number would insert it
      // anyway and die on the primary key, with the raw constraint name as
      // the message. Say what actually happened instead.
      if (!allocatedDocNo) {
        throw new HandledError(500, "ບໍ່ສາມາດຈອງເລກເອກະສານຮັບຄືນໄດ້");
      }

      // 6. Insert the CTPL header. Amounts positive — trans_flag 48 is what
      //    says "return", exactly as SML writes its own.
      const returnKip = partial
        ? partialKip
        : Number(cak.total_amount_2 ?? 0);
      const returnThb = partial
        ? partialThb
        : Number(cak.total_amount ?? 0);
      const exchangeRate = cak.exchange_rate ? Number(cak.exchange_rate) : 1;
      const refRemark = partial
        ? `ຄືນເຄື່ອງບາງລາຍການ ${docNo}${reason ? ` · ${reason}` : ""}`
        : `ຍົກເລີກ ${docNo}${reason ? ` · ${reason}` : ""}`;
      await tx.$executeRaw`
        INSERT INTO ic_trans (
          trans_type, trans_flag,
          doc_date, doc_no, doc_time,
          doc_ref, doc_ref_date,
          inquiry_type,
          cust_code,
          branch_code, department_code,
          currency_code, exchange_rate,
          total_value, total_value_2,
          total_amount, total_amount_2,
          vat_type,
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
          ${RETURN_TRANS_TYPE}, ${RETURN_TRANS_FLAG},
          CURRENT_DATE, ${newDocNo}, to_char(NOW(), 'HH24:MI'),
          ${docNo}, CURRENT_DATE,
          ${INQUIRY_TYPE},
          ${cak.cust_code ?? ""},
          ${cak.branch_code ?? "01"}, ${cak.department_code ?? ""},
          ${cak.currency_code ?? "02"}, ${exchangeRate},
          ${returnThb}, ${returnKip},
          ${returnThb}, ${returnKip},
          ${VAT_TYPE},
          ${userCode}, ${userCode}, ${cak.sale_code ?? ""},
          ${DOC_PREFIX}, ${SALE_GROUP},
          ${(cak.side_code ?? "").trim() || DEFAULT_SIDE_CODE},
          0, 0,
          0, 0,
          NOW(), NOW(),
          NOW(),
          ${refRemark}
        )
      `;

      // 7. Insert ic_trans_detail rows for the return.
      //
      //    Positive qty and positive amounts, calc_flag +1 against the sale's
      //    -1: that pairing is what puts the goods back. The stock function
      //    sums calc_flag * qty * stand_value/divide_value over rows with
      //    last_status = 0 and a doc_date_calc on or before the as-of date,
      //    so a row missing calc_flag, stand_value, divide_value or
      //    doc_date_calc is either arithmetically zero or filtered out
      //    entirely — the shelf never hears about the return.
      //
      //    wh_code/shelf_code mirror the original line, so the units land
      //    back on the shelf they left from.
      for (const d of docLines) {
        const qty = Number(d.qty ?? 0);
        const priceThb = Number(d.price ?? 0);
        const priceKip = Number(d.price_2 ?? 0);
        const sumThb = Number(d.sum_amount ?? 0);
        const sumKip = Number(d.sum_amount_2 ?? 0);
        const discountThb = Number(d.discount_amount ?? 0);
        const discountKip = Number(d.discount_amount_2 ?? 0);
        const sumCost = Number(d.sum_of_cost ?? 0);
        const avgCost = Number(d.average_cost ?? 0);
        // The sale wrote 1/1; anything else on the original line is the
        // item's own unit conversion and has to be carried across verbatim,
        // or the returned quantity converts to a different number of
        // standard units than the sale deducted.
        const standValue = Number(d.stand_value ?? 0) || 1;
        const divideValue = Number(d.divide_value ?? 0) || 1;
        await tx.$executeRaw`
          INSERT INTO ic_trans_detail (
            trans_type, trans_flag,
            doc_date, doc_no, doc_time,
            cust_code, branch_code,
            inquiry_type,
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
            ${RETURN_TRANS_TYPE}, ${RETURN_TRANS_FLAG},
            CURRENT_DATE, ${newDocNo}, to_char(NOW(), 'HH24:MI'),
            ${cak.cust_code ?? ""}, ${cak.branch_code ?? "01"},
            ${INQUIRY_TYPE},
            ${d.item_code}, ${d.item_name ?? d.item_code}, ${d.unit_code ?? ""},
            ${qty}, ${priceThb}, ${sumThb}, 0,
            ${priceKip}, ${sumKip},
            ${""}, ${discountThb}, ${discountKip},
            ${d.wh_code ?? ""}, ${d.shelf_code ?? ""},
            ${d.line_number},
            0, 0,
            ${standValue}, ${divideValue},
            ${RETURN_CALC_FLAG}, ${ITEM_TYPE},
            ${VAT_TYPE},
            1,
            ${sumThb}, ${priceThb},
            CURRENT_DATE, to_char(NOW(), 'HH24:MI'),
            ${PRICE_TYPE},
            ${d.sale_code ?? cak.sale_code ?? ""},
            ${(d.sale_group ?? "").trim() || SALE_GROUP},
            ${avgCost}, ${avgCost},
            ${sumCost}, ${sumCost},
            ${Number(d.set_ref_price ?? 0) || priceKip},
            NOW()
          )
        `;
      }

      // 8. Insert the refund cb_trans. Positive amounts under trans_flag 48,
      //    the way SML books its own returns — none of its 874 flag-48
      //    cashbook rows carries a negative. The flag is the direction.
      // Partial: the returned value goes back to the customer as cash,
      // whatever mix originally paid the bill — that is what a counter
      // refund is. Full void reverses the original split.
      const cashRefund = partial ? returnThb : Number(cb?.cash_amount ?? 0);
      const transferRefund = partial ? 0 : Number(cb?.tranfer_amount ?? 0);
      const otherRefund = partial ? 0 : Number(cb?.total_other_currency ?? 0);
      const cbTotalRefund = partial ? returnThb : Number(cb?.total_amount ?? 0);
      const cbPayRefund = partial
        ? returnThb
        : Number(cb?.total_amount_pay ?? 0);
      await tx.$executeRaw`
        INSERT INTO cb_trans (
          trans_type, trans_flag,
          doc_date, doc_no, doc_time,
          ap_ar_code,
          branch_code,
          currency_code, exchange_rate,
          total_amount, total_net_amount,
          cash_amount, tranfer_amount,
          total_other_currency,
          total_amount_pay,
          doc_format_code,
          cashier_code,
          status,
          create_date_time_now,
          remark
        )
        VALUES (
          ${RETURN_TRANS_TYPE}, ${RETURN_TRANS_FLAG},
          CURRENT_DATE, ${newDocNo}, to_char(NOW(), 'HH24:MI'),
          ${cak.cust_code ?? ""},
          ${cak.branch_code ?? "01"},
          '', 0,
          ${cbTotalRefund}, ${cbTotalRefund},
          ${cashRefund}, ${transferRefund},
          ${otherRefund},
          ${cbPayRefund},
          ${DOC_PREFIX},
          ${userCode},
          0,
          NOW(),
          ${refRemark}
        )
      `;

      // 9. Mark the original CAKAP cancelled — full void only. A partial
      //    return leaves the bill standing; the CTPL rows carry the
      //    correction.
      if (!partial) {
        await tx.$executeRaw`
          UPDATE ic_trans
          SET status = 2,
              is_cancel = 1,
              cancel_type = 1,
              lastedit_datetime = NOW()
          WHERE doc_no = ${docNo}
        `;
      }

      // 9b. Hand the manager's bill-discount approval back — full void only.
      //     Settling burns the request ('used') so it can't be spent twice.
      //     When the bill it was spent on is cancelled, nothing was spent,
      //     and leaving it burnt means the counter has to fetch a manager
      //     again to re-approve a discount that was already granted.
      const settledCartNumber = (audit?.cart_number ?? "").trim();
      if (!partial && settledCartNumber) {
        await tx.$executeRaw`
          UPDATE app_price_request
          SET status = 'approved',
              approver_note = COALESCE(approver_note, '') ||
                ${' · ຄືນສິດ ຍ້ອນຍົກເລີກ ' + docNo}
          WHERE cart_number = ${settledCartNumber}
            AND item_code = ${BILL_DISCOUNT_ITEM_CODE}
            AND status = 'used'
        `;
      }

      // 9c. Put the order back on the counter — full void only.
      //
      //     Cancelling the bill returns the goods and the money, but the
      //     order behind it stayed settled with tax_doc_no still pinned to
      //     the cancelled receipt, so it could never be rung up again: the
      //     only way to re-issue was to type the whole order in afresh, and
      //     the discount the manager had already approved was gone with it.
      //     Reopening it is the same move the receipt-delete path makes.
      //
      //     A partial return leaves the bill standing, so its order stays
      //     settled too.
      if (!partial) {
        await tx.$executeRaw`
          UPDATE ic_trans
          SET status = 0,
              tax_doc_no = '',
              lastedit_datetime = NOW()
          WHERE doc_format_code = 'SOK'
            AND NULLIF(tax_doc_no, '') = ${docNo}
        `;

        //   The warehouse must stop reading the order as already picked, or
        //   the re-issued bill never reaches the "ຖ້າຈ່າຍ" queue and the
        //   goods go out twice on paper. The issue documents belong to the
        //   cancelled receipt, so they go with it — children first. The
        //   units themselves are already back on the shelf: sn_inventory is
        //   restored below, and the CTPL lines put the ERP balance back.
        await tx.$executeRaw`
          DELETE FROM wms_product_out_serial_detail
          WHERE ref_out_doc IN (
            SELECT doc_no FROM wms_product_out WHERE ref_doc_no = ${docNo}
          )
        `;
        await tx.$executeRaw`
          DELETE FROM wms_product_out_detail
          WHERE doc_no IN (
            SELECT doc_no FROM wms_product_out WHERE ref_doc_no = ${docNo}
          )
        `;
        await tx.$executeRaw`
          DELETE FROM wms_product_out WHERE ref_doc_no = ${docNo}
        `;
        await tx.$executeRaw`
          DELETE FROM odg_wms_trans_detail WHERE doc_ref = ${docNo}
        `;
        await tx.$executeRaw`
          DELETE FROM odg_wms_trans WHERE doc_ref = ${docNo}
        `;
        //   sn_trans / sn_trans_detail are dropped further down, after the
        //   serial restore has read them — that restore finds the units
        //   through exactly those rows.
      }

      // 10. Restore loyalty points. Earned points (sum_point on original
      //     header) get clawed back; redeemed points get returned. Both
      //     are idempotent because we update with the actual deltas.
      const totalKipAbs = Number(cak.total_amount_2 ?? 0);
      const earnedPtsFull = Math.floor(Number(cak.sum_point ?? 0));
      // Partial: claw back points in proportion to the value returned.
      const earnedPts = partial
        ? totalKipAbs > 0
          ? Math.floor((earnedPtsFull * partialKip) / totalKipAbs)
          : 0
        : earnedPtsFull;
      if (earnedPts > 0 && cak.cust_code) {
        await tx.$executeRaw`
          UPDATE ar_customer
          SET point_balance = GREATEST(0, COALESCE(point_balance, 0) - ${earnedPts})
          WHERE code = ${cak.cust_code}
        `;
      }
      // Redeemed points come back only on a full void — on a partial
      // return the discount already served its bill, and the refund is
      // cash for the goods.
      const redemptionRows = partial
        ? []
        : await tx.$queryRaw<RedemptionRow[]>`
        SELECT points_used, customer_code
        FROM app_loyalty_redemption
        WHERE doc_no = ${docNo}
      `;
      for (const r of redemptionRows) {
        if (r.points_used > 0 && r.customer_code) {
          await tx.$executeRaw`
            UPDATE ar_customer
            SET point_balance = COALESCE(point_balance, 0) + ${r.points_used}
            WHERE code = ${r.customer_code}
          `;
        }
      }

      // Serial-tracked units of a partial return go back on the shelf in
      // the WMS master — the first N of that item issued on this receipt,
      // since the paper cannot know which physical unit came back.
      if (partial) {
        for (const d of docLines) {
          await tx.$executeRaw`
            UPDATE sn_inventory
            SET status = 0, user_mapping = ${userCode}, updated_at = NOW()
            WHERE isn IN (
              SELECT sd.isn FROM sn_trans_detail sd
              WHERE sd.doc_ref = ${docNo}
                AND sd.item_code = ${d.item_code}
                AND COALESCE(sd.isn, '') <> ''
              LIMIT ${Math.ceil(Number(d.qty ?? 0))}
            )
          `;
        }
        // Who returned what, and for how much — the receipt history's
        // audit row stays untouched on a partial. Heals on demand, same
        // pattern as the delete log.
        await tx.$executeRaw`
          CREATE TABLE IF NOT EXISTS app_receipt_return_log (
            id            BIGSERIAL PRIMARY KEY,
            doc_no        VARCHAR(50) NOT NULL,
            return_doc_no VARCHAR(50) NOT NULL,
            total_kip     NUMERIC(18,2) NOT NULL,
            reason        TEXT,
            returned_by   VARCHAR(20) NOT NULL,
            returned_at   TIMESTAMP   NOT NULL DEFAULT NOW()
          )
        `;
        await tx.$executeRaw`
          INSERT INTO app_receipt_return_log
            (doc_no, return_doc_no, total_kip, reason, returned_by)
          VALUES (${docNo}, ${newDocNo}, ${partialKip}, ${reason}, ${userCode})
        `;
        return newDocNo;
      }

      // Every serial-tracked unit on the bill goes back on the shelf in
      // the WMS master — a voided sale means the goods came back. Matched
      // the way the WMS's own delete-issue restores: printed serial first,
      // company serial behind it, per item, only units actually issued.
      await tx.$executeRaw`
        UPDATE sn_inventory s
        SET status = 0, user_mapping = ${userCode}, updated_at = NOW()
        FROM sn_trans_detail d
        WHERE d.doc_ref = ${docNo}
          AND COALESCE(NULLIF(s.sn, ''), s.isn)
              = COALESCE(NULLIF(d.sn, ''), d.isn)
          AND s.item_code = d.item_code
          AND COALESCE(s.status, 0) = 1
      `;

      // Now that the units are back on the shelf, drop the issue that put
      // them out. The order is going back on the counter (step 9c) and the
      // re-issued bill has to be able to hand the same units out again;
      // sn_trans_detail is what marks them as already gone.
      await tx.$executeRaw`
        DELETE FROM sn_trans WHERE doc_no IN (
          SELECT DISTINCT doc_no FROM sn_trans_detail WHERE doc_ref = ${docNo}
        )
      `;
      await tx.$executeRaw`
        DELETE FROM sn_trans_detail WHERE doc_ref = ${docNo}
      `;

      // 11. Stamp the settle audit so receipt history shows the void.
      //     The original audit row remains (history is append-only via
      //     INSERT in settle), so the void column tells us "this CAKAP
      //     was undone by ${void_doc_no}".
      await tx.$executeRaw`
        INSERT INTO app_settle_audit (
          doc_no, cart_number, cashier_code,
          total_kip, cash_kip, transfer_kip,
          redeemed_kip, promo_kip,
          is_voided, voided_at, voided_by, void_doc_no, void_reason
        )
        VALUES (
          ${docNo}, ${cak.cart_number}, ${cak.cashier_code ?? userCode},
          ${Number(cak.total_amount_2 ?? 0)}, 0, 0,
          0, 0,
          TRUE, NOW(), ${userCode}, ${newDocNo}, ${reason}
        )
        ON CONFLICT (doc_no) DO UPDATE
          SET is_voided = TRUE,
              voided_at = NOW(),
              voided_by = ${userCode},
              void_doc_no = ${newDocNo},
              void_reason = ${reason}
      `;

      // Silence unused-import warning on Prisma when the file ends up
      // using only template strings.
      void Prisma;

      return newDocNo;
    });

    return NextResponse.json({ ok: true, voidDocNo, reason, partial });
  } catch (e) {
    if (e instanceof HandledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // Postgres error text — constraint names, table names, statement
    // fragments — belongs in the log, not on the till's screen.
    console.error(`[cashier/void] voiding ${docNo} failed:`, e);
    return NextResponse.json(
      { error: "ຍົກເລີກບໍ່ສຳເລັດ ເນື່ອງຈາກຂໍ້ຜິດພາດຂອງລະບົບ — ກະລຸນາລອງໃໝ່ ຫຼື ແຈ້ງ IT" },
      { status: 500 },
    );
  }
}

class HandledError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
