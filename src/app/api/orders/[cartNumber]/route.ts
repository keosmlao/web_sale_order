import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canCancelOrders, roleFromEmployee } from "@/lib/roles";

type RouteContext = {
  params: Promise<{ cartNumber: string }>;
};

class HandledError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// SOK ic_trans.status convention (matches src/app/api/orders/route.ts):
//   0 = PENDING (draft, not yet settled)
//   1 = COMPLETED (settled at cashier — set by /api/cashier/settle)
//   2 = CANCELLED
//
// The "ຈັດຖ້ຽວ" (SCHEDULED) state is derived at read time from the
// presence of a odg_tms_detail row keyed by bill_no = SOK doc_no, so
// no PATCH transition needed here.

type Action = "cancel" | "reopen";

const STATUS_PENDING = 0;
const STATUS_COMPLETED = 1;
const STATUS_CANCELLED = 2;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າໃຊ້" }, { status: 401 });
  }
  if (!canCancelOrders(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະຫົວໜ້າ ຫຼື ຜູ້ຈັດການ ປ່ຽນສະຖານະ Order ໄດ້" },
      { status: 403 },
    );
  }

  const { cartNumber } = await context.params;
  const id = cartNumber.trim();
  if (!id) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸເລກກະຕ່າ" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    reason?: unknown;
  } | null;
  const action = body?.action;
  if (action !== "cancel" && action !== "reopen") {
    return NextResponse.json(
      { error: "action ຕ້ອງເປັນ 'cancel' ຫຼື 'reopen'" },
      { status: 400 },
    );
  }
  const next: Action = action;
  const reason =
    typeof body?.reason === "string" && body.reason.trim() !== ""
      ? body.reason.trim()
      : null;
  // Cancellations need a stated reason so the audit log has something to
  // show. Reopen is fine without one.
  if (next === "cancel" && !reason) {
    return NextResponse.json(
      { error: "ກະລຸນາໃສ່ເຫດຜົນຍົກເລີກ" },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Look up the SOK doc by cart_number (= doc_no suffix).
      const rows = await tx.$queryRaw<
        Array<{ doc_no: string; status: number | null }>
      >`
        SELECT doc_no, status
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
      const current = cart.status ?? STATUS_PENDING;
      if (current === STATUS_COMPLETED) {
        throw new HandledError(
          409,
          `ກະຕ່າ ${id} ຖືກຮັບເງິນແລ້ວ, ປ່ຽນສະຖານະບໍ່ໄດ້`,
        );
      }
      const target = next === "cancel" ? STATUS_CANCELLED : STATUS_PENDING;
      if (current === target) {
        return { status: target };
      }
      if (next === "reopen" && current !== STATUS_CANCELLED) {
        throw new HandledError(
          409,
          `ກະຕ່າ ${id} ຍັງບໍ່ໄດ້ຖືກຍົກເລີກ`,
        );
      }

      await tx.$executeRaw`
        UPDATE ic_trans
        SET status = ${target}, lastedit_datetime = NOW(),
            is_cancel = CASE WHEN ${target} = ${STATUS_CANCELLED} THEN 1 ELSE 0 END
        WHERE doc_no = ${cart.doc_no}
          AND doc_format_code = 'SOK'
      `;
      // Append-only audit row.
      await tx.appOrderAudit.create({
        data: {
          cartNumber: id,
          action: next,
          actorCode: employee.employeeCode ?? "",
          reason,
        },
      });
      return { status: target };
    });

    const label =
      result.status === STATUS_CANCELLED
        ? "CANCELLED"
        : result.status === STATUS_COMPLETED
          ? "COMPLETED"
          : "PENDING";
    return NextResponse.json({ id, status: label });
  } catch (e) {
    if (e instanceof HandledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
