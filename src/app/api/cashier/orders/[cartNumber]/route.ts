import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";

type RouteContext = {
  params: Promise<{ cartNumber: string }>;
};

class HandledError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າໃຊ້" }, { status: 401 });
  }

  const { cartNumber } = await context.params;
  const id = cartNumber.trim();
  if (!id) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸເລກກະຕ່າ" },
      { status: 400 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ doc_no: string; status: number | null; tax_doc_no: string | null }>
      >`
        SELECT doc_no, status, NULLIF(tax_doc_no, '') AS tax_doc_no
        FROM ic_trans
        WHERE doc_format_code = 'SOK'
          AND SUBSTRING(doc_no FROM 6) = ${id}
        ORDER BY create_date_time_now DESC
        LIMIT 1
        FOR UPDATE
      `;
      const cart = rows[0];
      if (!cart) {
        throw new HandledError(404, `ບໍ່ພົບກະຕ່າ ${id}`);
      }
      // A settled receipt is money that has already changed hands: what
      // follows below unwinds the cash ledger, the stock movement and any
      // loyalty points spent on it.
      //
      // A manager may always do it. So may the cashier who raised the
      // receipt, on the same day — a receipt issued by mistake at eight in
      // the evening should not wait for a manager who has gone home, and
      // the person who made the mistake is the one who can still remember
      // what actually happened. Anyone else's receipt, or an older one,
      // still needs a manager: by then it has been through a shift
      // reconciliation and undoing it is no longer a correction.
      //
      // An unsettled order is still just a promise, and the salesperson
      // who wrote it can drop it.
      if ((cart.status ?? 0) === 1) {
        const role = roleFromEmployee({
          appRole: employee.appRole,
          positionCode: employee.positionCode,
        });
        if (!canApprovePriceRequests(role)) {
          const receiptDocNo = cart.tax_doc_no?.trim() ?? "";
          const ownRows = await tx.$queryRaw<
            Array<{ mine: boolean; today: boolean; cashier_code: string | null }>
          >`
            SELECT
              cashier_code = ${employee.employeeCode ?? ""} AS mine,
              create_date_time_now::date = CURRENT_DATE AS today,
              cashier_code
            FROM ic_trans
            WHERE doc_no = ${receiptDocNo}
              AND doc_format_code = 'CAKAP'
            LIMIT 1
          `;
          const own = ownRows[0];
          if (!own?.mine) {
            throw new HandledError(
              403,
              "ບິນນີ້ບໍ່ແມ່ນທ່ານເປັນຄົນຮັບເງິນ — ລົບໄດ້ສະເພາະຜູ້ຈັດການ",
            );
          }
          if (!own.today) {
            throw new HandledError(
              403,
              "ບິນຂ້າມມື້ແລ້ວ — ລົບໄດ້ສະເພາະຜູ້ຈັດການ",
            );
          }
        }
      }
      if ((cart.status ?? 0) === 1) {
        const receiptDocNo = cart.tax_doc_no?.trim();
        if (!receiptDocNo) {
          throw new HandledError(
            409,
            `ກະຕ່າ ${id} ຖືກຮັບເງິນແລ້ວ ແຕ່ບໍ່ພົບເລກໃບຮັບເງິນ`,
          );
        }
        const tmsRows = await tx.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM odg_tms_detail
            WHERE bill_no = ${receiptDocNo}
          ) AS exists
        `;
        if (tmsRows[0]?.exists) {
          throw new HandledError(
            409,
            `ໃບຮັບເງິນ ${receiptDocNo} ຖືກຈັດຖ້ຽວແລ້ວ, ລົບບໍ່ໄດ້`,
          );
        }

        // Record who did this, before anything is deleted — the row below
        // reads ic_trans, which the deletes that follow remove.
        //
        // A delete otherwise leaves nothing behind saying the sale ever
        // happened or that anyone undid it: fine for the ledger, wrong for
        // accountability, now that a cashier can delete their own same-day
        // receipt without a manager. The table is created on demand so an
        // un-migrated database heals itself rather than failing the
        // delete; see sql/add-receipt-delete-log.sql.
        await tx.$executeRaw`
          CREATE TABLE IF NOT EXISTS app_receipt_delete_log (
            id            BIGSERIAL PRIMARY KEY,
            doc_no        VARCHAR(50)  NOT NULL,
            cart_number   VARCHAR(50),
            total_kip     NUMERIC(18, 2),
            settled_by    VARCHAR(50),
            deleted_by    VARCHAR(50)  NOT NULL,
            deleted_role  VARCHAR(30),
            deleted_at    TIMESTAMP    NOT NULL DEFAULT NOW()
          )
        `;
        await tx.$executeRaw`
          INSERT INTO app_receipt_delete_log
            (doc_no, cart_number, total_kip, settled_by, deleted_by, deleted_role)
          SELECT ${receiptDocNo}, ${id}, t.total_amount_2, t.cashier_code,
                 ${employee.employeeCode ?? ""},
                 ${roleFromEmployee({
                   appRole: employee.appRole,
                   positionCode: employee.positionCode,
                 })}
          FROM ic_trans t
          WHERE t.doc_no = ${receiptDocNo}
            AND t.doc_format_code = 'CAKAP'
          LIMIT 1
        `;

        await tx.$executeRaw`
          DELETE FROM app_transfer_slip
          WHERE doc_no = ${receiptDocNo}
        `;
        await tx.$executeRaw`
          DELETE FROM app_payment_line
          WHERE doc_no = ${receiptDocNo}
        `;
        await tx.$executeRaw`
          DELETE FROM cb_trans_detail
          WHERE doc_no = ${receiptDocNo} AND trans_type = 2 AND trans_flag = 44
        `;
        await tx.$executeRaw`
          DELETE FROM cb_trans
          WHERE doc_no = ${receiptDocNo} AND trans_type = 2 AND trans_flag = 44
        `;
        await tx.$executeRaw`
          DELETE FROM ic_trans_shipment
          WHERE doc_no = ${receiptDocNo} AND trans_flag = 44
        `;
        await tx.$executeRaw`
          DELETE FROM ic_trans_detail
          WHERE doc_no = ${receiptDocNo} AND trans_type = 2 AND trans_flag = 44
        `;
        await tx.$executeRaw`
          DELETE FROM ic_trans
          WHERE doc_no = ${receiptDocNo} AND trans_type = 2 AND trans_flag = 44
        `;
        // Restore any loyalty points redeemed on this receipt before dropping
        // the redemption rows — a delete must fully undo the settle's
        // side-effects, never leave the customer short on points.
        const redemptions = await tx.$queryRaw<
          Array<{ points_used: number; customer_code: string }>
        >`
          SELECT points_used, customer_code
          FROM app_loyalty_redemption
          WHERE doc_no = ${receiptDocNo}
        `;
        for (const r of redemptions) {
          if (r.points_used > 0 && r.customer_code) {
            await tx.$executeRaw`
              UPDATE ar_customer
              SET point_balance = COALESCE(point_balance, 0) + ${r.points_used}
              WHERE code = ${r.customer_code}
            `;
          }
        }
        await tx.$executeRaw`
          DELETE FROM app_loyalty_redemption
          WHERE doc_no = ${receiptDocNo}
        `;
        // The settle audit row drives receipt history + the shift X/Z report
        // and carries its own UNIQUE(doc_no). Leaving it behind keeps the
        // "deleted" receipt visible in history and lets a later settle reuse
        // this doc_no, colliding on app_settle_audit_doc_no_key.
        await tx.$executeRaw`
          DELETE FROM app_settle_audit
          WHERE doc_no = ${receiptDocNo}
        `;
        await tx.$executeRaw`
          UPDATE app_price_request
          SET status = 'approved'
          WHERE cart_number = ${id}
            AND item_code = ${BILL_DISCOUNT_ITEM_CODE}
            AND status = 'used'
        `;
        await tx.$executeRaw`
          UPDATE ic_trans
          SET status = 0,
              tax_doc_no = '',
              lastedit_datetime = NOW()
          WHERE doc_no = ${cart.doc_no}
            AND doc_format_code = 'SOK'
        `;
        return;
      }

      await tx.$executeRaw`
        DELETE FROM ic_trans_detail
        WHERE doc_no = ${cart.doc_no} AND trans_type = 2
      `;
      await tx.$executeRaw`
        DELETE FROM ic_trans
        WHERE doc_no = ${cart.doc_no} AND doc_format_code = 'SOK'
      `;
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HandledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
