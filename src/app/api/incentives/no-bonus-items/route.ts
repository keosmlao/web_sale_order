import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Items exempt from bonus points. Rides on the existing product-status mechanism:
// status special_no_bonus has multiplier 0 in app_incentive_status_multiplier, so
// every report that scores points honours this dated list. Changes begin today
// so editing the current setup cannot rewrite a closed historical report.

const NO_BONUS = "special_no_bonus";

type ItemRow = {
  item_code: string;
  item_name: string | null;
  note: string | null;
  effective_from: string;
  effective_to: string;
  status_code: string;
  weight: string | number;
};

const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
};

async function listItems(year: number, month: number) {
  const rows = await prisma.$queryRaw<ItemRow[]>`
    SELECT ps.item_code, i.name_1 AS item_name, ps.note, ps.status_code, ps.weight,
           ps.effective_from::text, ps.effective_to::text
    FROM app_incentive_product_status_rule ps
    LEFT JOIN ic_inventory i ON i.code = ps.item_code
    WHERE ps.effective_from < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
      AND ps.effective_to >= make_date(${year}, ${month}, 1)
    ORDER BY ps.item_code
  `;
  return {
    items: rows.map((r) => ({
      itemCode: r.item_code,
      itemName: r.item_name ?? "",
      note: r.note ?? "",
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      statusCode: r.status_code,
      weight: Number(r.weight),
    })),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
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
        ...(await listItems(year, month)),
        matches: matches.map((m) => ({ itemCode: m.code, itemName: m.name_1 ?? "" })),
      });
    }
    return NextResponse.json(await listItems(year, month));
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
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!itemCode || itemCode.length > 50 || !Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "ລະຫັດສິນຄ້າບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO app_incentive_product_status_rule
        (item_code, status_code, weight, note, effective_from, effective_to)
      VALUES (${itemCode}, ${NO_BONUS}, 0, ${note || null}, make_date(${year},${month},1),
              (make_date(${year},${month},1) + INTERVAL '1 month - 1 day')::date)
      ON CONFLICT (item_code, effective_from) DO UPDATE SET
        status_code=EXCLUDED.status_code, weight=EXCLUDED.weight,
        note=EXCLUDED.note, effective_to=EXCLUDED.effective_to, updated_at=now()
    `;
    await tx.$executeRaw`
      DELETE FROM app_incentive_product_status WHERE item_code=${itemCode}
    `;
    await tx.$executeRaw`
      INSERT INTO app_incentive_product_status (item_code,status_code,weight,note)
      SELECT item_code,status_code,weight,note FROM app_incentive_product_status_rule
      WHERE item_code=${itemCode} AND CURRENT_DATE BETWEEN effective_from AND effective_to
      ORDER BY updated_at DESC LIMIT 1
    `;
  });
  return NextResponse.json(await listItems(year, month));
}

// Remove the exemption — the item counts points normally again.
export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ລາຍການຍົກເວັ້ນ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const itemCode = String(body?.itemCode ?? "").trim();
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!itemCode || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "ລະຫັດ/ເດືອນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM app_incentive_product_status_rule
      WHERE item_code = ${itemCode} AND status_code = ${NO_BONUS}
        AND effective_from = make_date(${year},${month},1)
    `;
    await tx.$executeRaw`
      DELETE FROM app_incentive_product_status
      WHERE item_code = ${itemCode} AND status_code = ${NO_BONUS}
    `;
    await tx.$executeRaw`
      INSERT INTO app_incentive_product_status (item_code,status_code,weight,note)
      SELECT item_code,status_code,weight,note FROM app_incentive_product_status_rule
      WHERE item_code=${itemCode} AND CURRENT_DATE BETWEEN effective_from AND effective_to
      ORDER BY updated_at DESC LIMIT 1
    `;
  });
  return NextResponse.json(await listItems(year, month));
}
