import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";

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
