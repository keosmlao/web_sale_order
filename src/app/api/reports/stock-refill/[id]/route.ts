import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import {
  canApproveRefillRequests,
  roleFromEmployee,
} from "@/lib/roles";

// PATCH /api/reports/stock-refill/[id]
// Body: { action: 'approve' | 'reject' | 'fulfill' | 'cancel',
//         note?: string, refDocNo?: string }
//
// Lifecycle gates:
//   pending  -> approved  (action='approve', requires head/manager)
//   pending  -> rejected  (action='reject',  requires head/manager)
//   pending  -> cancelled (action='cancel',  requestor or head/manager)
//   approved -> fulfilled (action='fulfill', requires head/manager)
// Any other transition is a 409.

type Body = {
  action?: string;
  note?: string;
  refDocNo?: string;
};

type Row = {
  id: bigint;
  status: string;
  requestor_code: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!me.employeeCode) {
    return NextResponse.json({ error: "ບໍ່ມີ employeeCode" }, { status: 400 });
  }

  const { id: idRaw } = await params;
  let id: bigint;
  try {
    id = BigInt(idRaw);
  } catch {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const action = body?.action?.trim().toLowerCase() ?? "";
  const note = body?.note?.trim() || null;
  const refDocNo = body?.refDocNo?.trim() || null;

  if (!["approve", "reject", "fulfill", "cancel"].includes(action)) {
    return NextResponse.json({ error: "action ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const role = roleFromEmployee(me);
  const canApprove = canApproveRefillRequests(role);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, status, requestor_code
    FROM app_stock_refill_request
    WHERE id = ${id}
    FOR UPDATE
  `;
  const req = rows[0];
  if (!req) {
    return NextResponse.json({ error: "ບໍ່ພົບຄຳຂໍ" }, { status: 404 });
  }

  // Permission + lifecycle gate.
  if (action === "approve" || action === "reject") {
    if (!canApprove) {
      return NextResponse.json(
        { error: "ສະເພາະຫົວໜ້າ/ຜູ້ຈັດການອະນຸມັດ/ປະຕິເສດ" },
        { status: 403 },
      );
    }
    if (req.status !== "pending") {
      return NextResponse.json(
        { error: `ບໍ່ສາມາດປ່ຽນສະຖານະຈາກ ${req.status}` },
        { status: 409 },
      );
    }
  } else if (action === "fulfill") {
    if (!canApprove) {
      return NextResponse.json(
        { error: "ສະເພາະຫົວໜ້າ/ຜູ້ຈັດການມາກວ່າເຕີມສຳເລັດ" },
        { status: 403 },
      );
    }
    if (req.status !== "approved") {
      return NextResponse.json(
        { error: `ຕ້ອງອະນຸມັດກ່ອນ (ສະຖານະ: ${req.status})` },
        { status: 409 },
      );
    }
  } else if (action === "cancel") {
    if (!canApprove && req.requestor_code !== me.employeeCode) {
      return NextResponse.json(
        { error: "ສະເພາະຜູ້ສ້າງຄຳຂໍ ຫຼື ຫົວໜ້າ/ຜູ້ຈັດການ" },
        { status: 403 },
      );
    }
    if (req.status !== "pending") {
      return NextResponse.json(
        { error: `ບໍ່ສາມາດຍົກເລີກຈາກສະຖານະ ${req.status}` },
        { status: 409 },
      );
    }
  }

  const meCode = me.employeeCode;

  if (action === "approve") {
    await prisma.$executeRaw`
      UPDATE app_stock_refill_request
      SET status = 'approved',
          approver_code = ${meCode},
          approver_note = ${note},
          decided_at = NOW()
      WHERE id = ${id}
    `;
  } else if (action === "reject") {
    await prisma.$executeRaw`
      UPDATE app_stock_refill_request
      SET status = 'rejected',
          approver_code = ${meCode},
          approver_note = ${note},
          decided_at = NOW()
      WHERE id = ${id}
    `;
  } else if (action === "fulfill") {
    await prisma.$executeRaw`
      UPDATE app_stock_refill_request
      SET status = 'fulfilled',
          fulfiller_code = ${meCode},
          ref_doc_no = ${refDocNo},
          fulfilled_at = NOW()
      WHERE id = ${id}
    `;
  } else {
    // cancel
    await prisma.$executeRaw`
      UPDATE app_stock_refill_request
      SET status = 'cancelled',
          approver_note = ${note},
          decided_at = NOW()
      WHERE id = ${id}
    `;
  }

  return NextResponse.json({ ok: true });
}
