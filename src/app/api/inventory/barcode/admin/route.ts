import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Admin CRUD for ic_inventory_barcode.
//
//   GET    ?q=...        — list barcodes (joined with item name) filtered by
//                          barcode / item code / item name (ILIKE). Max 200.
//   POST   { barcode, icCode, note? }  — create.
//   DELETE ?barcode=...  — remove.
//
// All non-GET methods require head or manager role.

type Row = {
  barcode: string;
  ic_code: string;
  item_name: string | null;
  unit_name: string | null;
  note: string | null;
  created_by: string | null;
  created_at: Date;
};

function canManage(role: string): boolean {
  return role === "manager" || role === "head";
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const like = q ? `%${q}%` : null;
  const rows = like
    ? await prisma.$queryRaw<Row[]>`
        SELECT
          b.barcode,
          b.ic_code,
          i.name_1 AS item_name,
          i.unit_standard_name AS unit_name,
          b.note,
          b.created_by,
          b.created_at
        FROM ic_inventory_barcode b
        LEFT JOIN ic_inventory i ON i.code = b.ic_code
        WHERE b.barcode ILIKE ${like}
           OR b.ic_code ILIKE ${like}
           OR i.name_1  ILIKE ${like}
        ORDER BY b.created_at DESC
        LIMIT 200
      `
    : await prisma.$queryRaw<Row[]>`
        SELECT
          b.barcode,
          b.ic_code,
          i.name_1 AS item_name,
          i.unit_standard_name AS unit_name,
          b.note,
          b.created_by,
          b.created_at
        FROM ic_inventory_barcode b
        LEFT JOIN ic_inventory i ON i.code = b.ic_code
        ORDER BY b.created_at DESC
        LIMIT 200
      `;
  return NextResponse.json({
    rows: rows.map((r) => ({
      barcode: r.barcode,
      icCode: r.ic_code,
      itemName: r.item_name,
      unitName: r.unit_name,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManage(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະ head / manager" },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    barcode?: unknown;
    icCode?: unknown;
    note?: unknown;
  } | null;
  const barcode =
    typeof body?.barcode === "string" ? body.barcode.trim() : "";
  const icCode = typeof body?.icCode === "string" ? body.icCode.trim() : "";
  const note =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;
  if (!barcode || !icCode) {
    return NextResponse.json(
      { error: "barcode + icCode required" },
      { status: 400 },
    );
  }

  // Verify the item exists so we don't dangle barcodes against deleted SKUs.
  const itemRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ic_inventory WHERE code = ${icCode} LIMIT 1
  `;
  if (!itemRows[0]) {
    return NextResponse.json(
      { error: `ບໍ່ພົບສິນຄ້າ ${icCode}` },
      { status: 404 },
    );
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO ic_inventory_barcode (barcode, ic_code, note, created_by)
      VALUES (${barcode}, ${icCode}, ${note}, ${employee.employeeCode ?? ""})
    `;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate") || msg.includes("23505")) {
      return NextResponse.json(
        { error: `Barcode ${barcode} ມີຢູ່ແລ້ວ` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManage(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະ head / manager" },
      { status: 403 },
    );
  }
  const url = new URL(request.url);
  const barcode = url.searchParams.get("barcode")?.trim() ?? "";
  if (!barcode) {
    return NextResponse.json(
      { error: "barcode required" },
      { status: 400 },
    );
  }
  await prisma.$executeRaw`
    DELETE FROM ic_inventory_barcode WHERE barcode = ${barcode}
  `;
  return NextResponse.json({ ok: true });
}
