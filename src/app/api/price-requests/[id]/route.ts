import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";
import { notifyEmployees } from "@/lib/notify";
import { BILL_DISCOUNT_ITEM_CODE } from "@/lib/payment";

type RouteContext = {
  params: Promise<{ id: string }>;
};

class HandledError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// PATCH /api/price-requests/[id]
// Body: { action: 'approve' | 'reject', note?: string }
// Approve flow: set status, apply override to order_item.price/amount, and
// recompute order_cart.amount in one transaction. The line discount_word
// ("X%") is preserved by scaling amount in the same ratio as the price.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canApprovePriceRequests(roleFromEmployee(me))) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ອະນຸມັດໄດ້" },
      { status: 403 },
    );
  }
  const { id } = await context.params;
  const requestId = BigInt(id);

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    note?: unknown;
    // The approver supplies the concrete price at decision time.
    // Requestors never send this — they only submit a proposal.
    approvedPrice?: unknown;
  } | null;
  const action = body?.action;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action ຕ້ອງເປັນ 'approve' ຫຼື 'reject'" },
      { status: 400 },
    );
  }
  const note =
    typeof body?.note === "string" && body.note.trim() !== ""
      ? body.note.trim()
      : null;
  // Reject without a note offers the salesperson no signal — require one.
  if (action === "reject" && !note) {
    return NextResponse.json(
      { error: "ກະລຸນາໃສ່ເຫດຜົນປະຕິເສດ" },
      { status: 400 },
    );
  }
  // Validate approved price up front so the tx body can rely on it.
  let approvedPriceKip: number | null = null;
  if (action === "approve") {
    const raw =
      typeof body?.approvedPrice === "number"
        ? body.approvedPrice
        : typeof body?.approvedPrice === "string"
          ? Number(body.approvedPrice)
          : NaN;
    if (!Number.isFinite(raw) || raw <= 0) {
      return NextResponse.json(
        { error: "ກະລຸນາໃສ່ລາຄາທີ່ອະນຸມັດ (ກີບ)" },
        { status: 400 },
      );
    }
    approvedPriceKip = raw;
  }

  // Captured outside the tx so the notify step has it after commit.
  // cartNumber is null for standalone requests (created from the dedicated
  // Price Request menu, before any cart exists).
  let notifyData: {
    requestorCode: string;
    cartNumber: string | null;
    itemCode: string;
  } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.appPriceRequest.findUnique({
        where: { id: requestId },
      });
      if (!req) throw new HandledError(404, "ບໍ່ພົບຄຳຂໍ");
      if (req.status !== "pending") {
        throw new HandledError(409, `ຄຳຂໍຖືກ ${req.status} ແລ້ວ`);
      }
      // Refuse approvals that are not actually a discount — the manager's
      // entered price has to be below the originalPrice the requestor
      // recorded, otherwise approval is meaningless.
      if (action === "approve" && approvedPriceKip !== null) {
        const original = Number(req.originalPrice);
        if (approvedPriceKip >= original) {
          throw new HandledError(
            400,
            `ລາຄາທີ່ອະນຸມັດຕ້ອງຕ່ຳກວ່າລາຄາເດີມ (${original})`,
          );
        }
      }

      // Bill-discount requests (sentinel itemCode) only need a status flip —
      // the discount is applied by the cashier at settle time, not against
      // any line. Skip the SOK mutation block.
      const isBillDiscount = req.itemCode === BILL_DISCOUNT_ITEM_CODE;

      // Cart-bound non-sentinel request: apply the override on the SOK
      // ic_trans_detail row + bump the SOK header total accordingly.
      if (action === "approve" && req.cartNumber && !isBillDiscount) {
        // Locate the SOK doc + matching detail line by (cart_number,
        // item_code). cart_number is the 5-digit doc_no suffix.
        const lineRows = await tx.$queryRaw<
          Array<{
            doc_no: string;
            trans_type: number;
            trans_flag: number;
            line_number: number;
            price_2: string | number | null;
            sum_amount_2: string | number | null;
            exchange_rate: string | number | null;
          }>
        >`
          SELECT
            d.doc_no, d.trans_type, d.trans_flag, d.line_number,
            d.price_2, d.sum_amount_2,
            t.exchange_rate
          FROM ic_trans_detail d
          INNER JOIN ic_trans t
            ON t.doc_no = d.doc_no
           AND t.trans_type = d.trans_type
           AND t.trans_flag = d.trans_flag
          WHERE t.doc_format_code = 'SOK'
            AND SUBSTRING(t.doc_no FROM 6) = ${req.cartNumber}
            AND d.item_code = ${req.itemCode}
          ORDER BY t.create_date_time_now DESC, d.line_number
          LIMIT 1
          FOR UPDATE
        `;
        const line = lineRows[0];
        if (!line) {
          throw new HandledError(
            404,
            `ລາຍການສິນຄ້າ ${req.itemCode} ບໍ່ມີໃນກະຕ່າ ${req.cartNumber}`,
          );
        }
        const oldPriceKip = line.price_2 ? Number(line.price_2) : 0;
        const oldAmountKip = line.sum_amount_2 ? Number(line.sum_amount_2) : 0;
        // approvedPriceKip is non-null here because action === 'approve'
        // is guarded above.
        const newPriceKip = approvedPriceKip!;
        // Scale the existing amount in the same ratio as price so the line
        // discount stays consistent. If oldPrice is 0 (shouldn't happen for
        // a sellable item), fall back to newPriceKip.
        const newAmountKip =
          oldPriceKip > 0 ? (oldAmountKip * newPriceKip) / oldPriceKip : newPriceKip;
        const deltaKip = newAmountKip - oldAmountKip;
        const rate = line.exchange_rate ? Number(line.exchange_rate) : 0;
        const newPriceThb =
          rate > 0 ? Math.round(newPriceKip * rate * 10000) / 10000 : 0;
        const newAmountThb =
          rate > 0 ? Math.round(newAmountKip * rate * 100) / 100 : 0;
        const deltaThb =
          rate > 0 ? Math.round(deltaKip * rate * 100) / 100 : 0;

        await tx.$executeRaw`
          UPDATE ic_trans_detail
          SET price = ${newPriceThb},
              sum_amount = ${newAmountThb},
              sum_amount_exclude_vat = ${newAmountThb},
              price_exclude_vat = ${newPriceThb},
              price_2 = ${newPriceKip},
              sum_amount_2 = ${newAmountKip}
          WHERE doc_no = ${line.doc_no}
            AND trans_type = ${line.trans_type}
            AND trans_flag = ${line.trans_flag}
            AND line_number = ${line.line_number}
        `;
        // Header total moves by exactly the line delta.
        await tx.$executeRaw`
          UPDATE ic_trans
          SET total_amount = total_amount + ${deltaThb},
              total_amount_2 = total_amount_2 + ${deltaKip},
              total_value = total_value + ${deltaThb},
              total_value_2 = total_value_2 + ${deltaKip},
              lastedit_datetime = NOW()
          WHERE doc_no = ${line.doc_no}
            AND doc_format_code = 'SOK'
        `;
      }

      await tx.appPriceRequest.update({
        where: { id: requestId },
        data: {
          status: action === "approve" ? "approved" : "rejected",
          approverCode: me.employeeCode ?? "",
          approverNote: note,
          decidedAt: new Date(),
          // Lock in the approver's price on approve. Rejection leaves it
          // NULL so reports can tell "decided without a number" apart from
          // "still pending" by checking status.
          ...(action === "approve" && approvedPriceKip !== null
            ? { requestedPrice: new Prisma.Decimal(approvedPriceKip) }
            : {}),
        },
      });
      notifyData = {
        requestorCode: req.requestorCode,
        cartNumber: req.cartNumber,
        itemCode: req.itemCode,
      };
    });
  } catch (e) {
    if (e instanceof HandledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Notify the requestor so they know the outcome without having to poll
  // their own orders. Fire-and-forget after the tx commits.
  if (notifyData) {
    const d = notifyData as {
      requestorCode: string;
      cartNumber: string | null;
      itemCode: string;
    };
    const approved = action === "approve";
    const isBillDiscount = d.itemCode === BILL_DISCOUNT_ITEM_CODE;
    // Standalone requests reference the item directly (no order yet).
    const subject = isBillDiscount
      ? `ສ່ວນຫຼຸດທ້າຍບິນ — ກະຕ່າ #${d.cartNumber ?? ""}`
      : d.cartNumber
        ? `Order #${d.cartNumber}`
        : `ສິນຄ້າ ${d.itemCode}`;
    notifyEmployees([d.requestorCode], {
      title: approved
        ? isBillDiscount
          ? "ສ່ວນຫຼຸດທ້າຍບິນຖືກອະນຸມັດ ✓"
          : "ຄຳຂໍລາຄາຖືກອະນຸມັດ ✓"
        : isBillDiscount
          ? "ສ່ວນຫຼຸດທ້າຍບິນຖືກປະຕິເສດ"
          : "ຄຳຂໍລາຄາຖືກປະຕິເສດ",
      body: `${subject}${note ? ` — ${note}` : ""}`,
      data: {
        type: approved
          ? isBillDiscount
            ? "bill_discount_approved"
            : "price_request_approved"
          : isBillDiscount
            ? "bill_discount_rejected"
            : "price_request_rejected",
        cartNumber: d.cartNumber ?? "",
        itemCode: d.itemCode,
      },
    }).catch((e) => {
      console.warn("[notify] notifyEmployees(requestor) failed:", e);
    });
  }

  return NextResponse.json({ ok: true });
}
