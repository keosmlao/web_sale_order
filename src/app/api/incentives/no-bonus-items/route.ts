import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Items exempt from bonus points. Rides on the existing product-status mechanism:
// status special_no_bonus has multiplier 0 in app_incentive_status_multiplier, so
// every report that scores points already honours this list — no report changes
// needed when an item is added or removed here.

const NO_BONUS = "special_no_bonus";

type ItemRow = { item_code: string; item_name: string | null; note: string | null };

const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
};

async function listItems() {
  const rows = await prisma.$queryRaw<ItemRow[]>`
    SELECT ps.item_code, i.name_1 AS item_name, ps.note
    FROM app_incentive_product_status ps
    LEFT JOIN ic_inventory i ON i.code = ps.item_code
    WHERE ps.status_code = ${NO_BONUS}
    ORDER BY ps.item_code
  `;
  return {
    items: rows.map((r) => ({
      itemCode: r.item_code,
      itemName: r.item_name ?? "",
      note: r.note ?? "",
    })),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  try {
    // With ?q= also return matching products from the item master so the editor
    // can offer a picker instead of blind item-code entry.
    if (q) {
      const like = `%${q}%`;
      const matches = await prisma.$queryRaw<Array<{ code: string; name_1: string | null }>>`
        SELECT code, name_1 FROM ic_inventory
        WHERE code ILIKE ${like} OR name_1 ILIKE ${like}
        ORDER BY code LIMIT 20
      `;
      return NextResponse.json({
        ...(await listItems()),
        matches: matches.map((m) => ({ itemCode: m.code, itemName: m.name_1 ?? "" })),
      });
    }
    return NextResponse.json(await listItems());
  } catch {
    return NextResponse.json(
      { error: "Product-status table missing. Run sql/add-sales-incentive.sql first." },
      { status: 503 },
    );
  }
}

// Add (or re-note) one exempt item.
export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ລາຍການຍົກເວັ້ນ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const itemCode = String(body?.itemCode ?? "").trim();
  const note = String(body?.note ?? "").trim();
  if (!itemCode || itemCode.length > 50) {
    return NextResponse.json({ error: "ລະຫັດສິນຄ້າບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  await prisma.$executeRaw`
    INSERT INTO app_incentive_product_status (item_code, status_code, weight, note)
    VALUES (${itemCode}, ${NO_BONUS}, 0, ${note || null})
    ON CONFLICT (item_code) DO UPDATE SET
      status_code = EXCLUDED.status_code, weight = EXCLUDED.weight,
      note = EXCLUDED.note, updated_at = now()
  `;
  return NextResponse.json(await listItems());
}

// Remove the exemption — the item counts points normally again.
export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ລາຍການຍົກເວັ້ນ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const itemCode = String(body?.itemCode ?? "").trim();
  if (!itemCode) return NextResponse.json({ error: "ລະຫັດສິນຄ້າບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  await prisma.$executeRaw`
    DELETE FROM app_incentive_product_status
    WHERE item_code = ${itemCode} AND status_code = ${NO_BONUS}
  `;
  return NextResponse.json(await listItems());
}
