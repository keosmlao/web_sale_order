import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest, verifyPassword } from "@/lib/auth";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";

// /api/cashier/void — issue a return document (CTPL) for a settled CAKAP
// receipt and reverse the original transaction's side-effects (stock,
// loyalty, settle audit). Requires manager PIN (or login password fallback)
// from a role that can approve price requests.
//
// Body: { docNo, reason, managerCode, managerPin }
//
// Doc convention (mirrors CAKAP for symmetry; SML treats it as a return):
//   doc_format_code = 'CTPL'
//   doc_no          = 'CTPL' + YY + MM + 4-digit seq (advisory lock)
//   trans_type      = 1 (purchase / return-in)
//   trans_flag      = 46 (sale return — SML legacy code)
//   amounts on ic_trans/ic_trans_detail/cb_trans are NEGATIVE of original
//   (preserves the original price columns; the sign distinguishes return)

const DOC_PREFIX = "CTPL";
const RETURN_TRANS_TYPE = 1;
const RETURN_TRANS_FLAG = 46;

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

function yy() {
  return new Date().getFullYear().toString().slice(-2);
}

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
  } | null;
  const docNo = typeof body?.docNo === "string" ? body.docNo.trim() : "";
  const reason =
    typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  const managerCode =
    typeof body?.managerCode === "string" ? body.managerCode.trim() : "";
  const managerPin =
    typeof body?.managerPin === "string" ? body.managerPin : "";

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
  const yearSuffix = yy();
  const monthSuffix = (new Date().getMonth() + 1).toString().padStart(2, "0");
  const yymm = `${yearSuffix}${monthSuffix}`;

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
          cashier_code, sale_code,
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
        SELECT redeemed_kip, is_voided FROM app_settle_audit
        WHERE doc_no = ${docNo}
        FOR UPDATE
      `;
      const audit = auditRows[0];
      if (audit?.is_voided === true) {
        throw new HandledError(409, `ໃບຮັບ ${docNo} ຖືກຍົກເລີກແລ້ວ`);
      }

      // 3. Load every detail line so we can flip them into CTPL with
      //    negative qty/amounts (preserves price columns for SML reports).
      const details = await tx.$queryRaw<CakDetailRow[]>`
        SELECT
          line_number, item_code, item_name, unit_code,
          qty, price, price_2, sum_amount, sum_amount_2,
          discount_amount, discount_amount_2,
          wh_code, shelf_code,
          average_cost, sum_of_cost
        FROM ic_trans_detail
        WHERE doc_no = ${docNo} AND trans_type = 2
        ORDER BY line_number
      `;
      if (details.length === 0) {
        throw new HandledError(500, "ໃບຮັບບໍ່ມີລາຍການສິນຄ້າ");
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

      // 5. Allocate CTPL doc_no with advisory lock.
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
      for (let i = 0; i < 20; i++) {
        const existsRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM ic_trans WHERE doc_no = ${newDocNo}
          ) AS exists
        `;
        if (!existsRows[0]?.exists) break;
        seq += 1;
        newDocNo = `${DOC_PREFIX}${yymm}${String(seq).padStart(4, "0")}`;
      }

      // 6. Insert CTPL header with negative totals.
      const totalKipNeg = -Number(cak.total_amount_2 ?? 0);
      const totalThbNeg = -Number(cak.total_amount ?? 0);
      const exchangeRate = cak.exchange_rate ? Number(cak.exchange_rate) : 1;
      const refRemark = `ຍົກເລີກ ${docNo}${reason ? ` · ${reason}` : ""}`;
      await tx.$executeRaw`
        INSERT INTO ic_trans (
          trans_type, trans_flag,
          doc_date, doc_no, doc_time,
          ref_doc_no, ref_doc_date,
          cust_code,
          branch_code, department_code,
          currency_code, exchange_rate,
          total_value, total_value_2,
          total_amount, total_amount_2,
          cashier_code, creator_code, sale_code,
          doc_format_code,
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
          ${cak.cust_code ?? ""},
          ${cak.branch_code ?? "01"}, ${cak.department_code ?? ""},
          ${cak.currency_code ?? "02"}, ${exchangeRate},
          ${totalThbNeg}, ${totalKipNeg},
          ${totalThbNeg}, ${totalKipNeg},
          ${userCode}, ${userCode}, ${cak.sale_code ?? ""},
          ${DOC_PREFIX},
          0, 1,
          0, 0,
          NOW(), NOW(),
          NOW(),
          ${refRemark}
        )
      `;

      // 7. Insert ic_trans_detail rows for the return — negative qty and
      //    negative amount. wh_code/shelf_code mirror the original so the
      //    stock function nets out (a CAK 'sale' minus a CTPL 'return' for
      //    the same wh/shelf restores balance).
      for (const d of details) {
        const qtyNeg = -Number(d.qty ?? 0);
        const priceThb = Number(d.price ?? 0);
        const priceKip = Number(d.price_2 ?? 0);
        const sumThbNeg = -Number(d.sum_amount ?? 0);
        const sumKipNeg = -Number(d.sum_amount_2 ?? 0);
        const discountThbNeg = -Number(d.discount_amount ?? 0);
        const discountKipNeg = -Number(d.discount_amount_2 ?? 0);
        const sumCostNeg = -Number(d.sum_of_cost ?? 0);
        await tx.$executeRaw`
          INSERT INTO ic_trans_detail (
            trans_type, trans_flag,
            doc_date, doc_no, doc_time,
            cust_code, branch_code,
            item_code, item_name, unit_code,
            qty, price, sum_amount,
            price_2, sum_amount_2,
            discount, discount_amount, discount_amount_2,
            wh_code, shelf_code,
            line_number,
            average_cost, sum_of_cost,
            create_date_time_now
          )
          VALUES (
            ${RETURN_TRANS_TYPE}, ${RETURN_TRANS_FLAG},
            CURRENT_DATE, ${newDocNo}, to_char(NOW(), 'HH24:MI'),
            ${cak.cust_code ?? ""}, ${cak.branch_code ?? "01"},
            ${d.item_code}, ${d.item_name ?? d.item_code}, ${d.unit_code ?? ""},
            ${qtyNeg}, ${priceThb}, ${sumThbNeg},
            ${priceKip}, ${sumKipNeg},
            ${""}, ${discountThbNeg}, ${discountKipNeg},
            ${d.wh_code ?? ""}, ${d.shelf_code ?? ""},
            ${d.line_number},
            ${Number(d.average_cost ?? 0)}, ${sumCostNeg},
            NOW()
          )
        `;
      }

      // 8. Insert reverse cb_trans with negative cash/transfer amounts
      //    so the cashbook balances after the void.
      const cashNeg = -Number(cb?.cash_amount ?? 0);
      const transferNeg = -Number(cb?.tranfer_amount ?? 0);
      const otherNeg = -Number(cb?.total_other_currency ?? 0);
      const cbTotalNeg = -Number(cb?.total_amount ?? 0);
      const cbPayNeg = -Number(cb?.total_amount_pay ?? 0);
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
          ${cbTotalNeg}, ${cbTotalNeg},
          ${cashNeg}, ${transferNeg},
          ${otherNeg},
          ${cbPayNeg},
          ${DOC_PREFIX},
          ${userCode},
          0,
          NOW(),
          ${refRemark}
        )
      `;

      // 9. Mark the original CAKAP cancelled. is_cancel=1 + status=2 is
      //    the legacy SML convention; downstream reports filter on status.
      await tx.$executeRaw`
        UPDATE ic_trans
        SET status = 2,
            is_cancel = 1,
            cancel_type = 1,
            lastedit_datetime = NOW()
        WHERE doc_no = ${docNo}
      `;

      // 10. Restore loyalty points. Earned points (sum_point on original
      //     header) get clawed back; redeemed points get returned. Both
      //     are idempotent because we update with the actual deltas.
      const earnedPts = Math.floor(Number(cak.sum_point ?? 0));
      if (earnedPts > 0 && cak.cust_code) {
        await tx.$executeRaw`
          UPDATE ar_customer
          SET point_balance = GREATEST(0, COALESCE(point_balance, 0) - ${earnedPts})
          WHERE code = ${cak.cust_code}
        `;
      }
      const redemptionRows = await tx.$queryRaw<RedemptionRow[]>`
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

    return NextResponse.json({ ok: true, voidDocNo, reason });
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
