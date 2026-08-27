import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canManagePromotions, roleFromEmployee } from "@/lib/roles";
import { giftSearchTerm, parseSheet, type SheetRow } from "@/lib/promo-sheet";

// Turn a pasted price sheet into promotions.
//
// Two passes on purpose. `dryRun` resolves every row against the catalogue
// and hands back what it found, so a sheet is checked before it prices
// anything; the second call, with the resolved gift codes, commits.
// Promotions decide what customers are charged — nothing here writes
// until someone has read what it is about to write.

type ResolvedRow = {
  line: number;
  itemCode: string;
  itemName: string | null;
  specialPrice: number | null;
  catalogPrice: number | null;
  giftText: string | null;
  giftMatches: Array<{ code: string; name: string }>;
  giftCode: string | null;
  kind: "fixed_price_period" | "bogo" | null;
  status: "ok" | "needs-gift" | "no-item" | "no-price";
  message: string | null;
};

type ItemRow = { code: string; name_1: string | null; price: number | null };

async function resolve(
  rows: SheetRow[],
  giftChoices: Record<string, string>,
): Promise<ResolvedRow[]> {
  const codes = [...new Set(rows.map((r) => r.itemCode))];
  const items = codes.length
    ? await prisma.$queryRaw<ItemRow[]>`
        SELECT
          i.code,
          i.name_1,
          price.sale_price1 AS price
        FROM ic_inventory i
        LEFT JOIN LATERAL (
          SELECT ipp.sale_price1
          FROM ic_inventory_price ipp
          WHERE ipp.ic_code = i.code
            AND ipp.currency_code = '02'
            AND COALESCE(ipp.sale_price1, 0) > 0
            AND COALESCE(ipp.status, 1) = 1
          ORDER BY ipp.roworder DESC
          LIMIT 1
        ) price ON true
        WHERE i.code = ANY(${codes})
      `
    : [];
  const byCode = new Map(items.map((i) => [i.code, i]));

  const out: ResolvedRow[] = [];
  for (const row of rows) {
    const item = byCode.get(row.itemCode);
    const base: ResolvedRow = {
      line: row.line,
      itemCode: row.itemCode,
      itemName: item?.name_1 ?? null,
      specialPrice: row.specialPrice,
      catalogPrice: item?.price != null ? Number(item.price) : null,
      giftText: row.giftText,
      giftMatches: [],
      giftCode: giftChoices[row.itemCode] ?? null,
      kind: null,
      status: "ok",
      message: null,
    };

    if (!item) {
      out.push({
        ...base,
        status: "no-item",
        message: `ບໍ່ພົບລະຫັດ ${row.itemCode} ໃນລະບົບ`,
      });
      continue;
    }

    if (row.giftText) {
      base.kind = "bogo";
      if (!base.giftCode) {
        const term = giftSearchTerm(row.giftText);
        // Match on the distinctive part — a model number if the sheet
        // gives one, otherwise the whole phrase. Several CENTON heaters
        // differ only by model, so this has to be confirmed by a person
        // rather than guessed at.
        const model = term.match(/[A-Z]{2,}[0-9][A-Z0-9-]*/i)?.[0] ?? term;
        const matches = await prisma.$queryRaw<
          Array<{ code: string; name_1: string }>
        >`
          SELECT code, name_1
          FROM ic_inventory
          WHERE COALESCE(status, 0) <> 1
            AND name_1 ILIKE ${"%" + model + "%"}
          ORDER BY name_1
          LIMIT 8
        `;
        base.giftMatches = matches.map((m) => ({
          code: m.code,
          name: m.name_1,
        }));
        if (base.giftMatches.length === 1) {
          base.giftCode = base.giftMatches[0].code;
        } else {
          out.push({
            ...base,
            status: "needs-gift",
            message: base.giftMatches.length
              ? "ເລືອກຂອງແຖມໃຫ້ຖືກລຸ້ນ"
              : `ຫາຂອງແຖມບໍ່ພົບ: ${row.giftText}`,
          });
          continue;
        }
      }
    } else {
      base.kind = "fixed_price_period";
      if (!row.specialPrice) {
        out.push({
          ...base,
          status: "no-price",
          message: "ບໍ່ມີລາຄາພິເສດ ແລະ ບໍ່ມີຂອງແຖມ — ບໍ່ມີຫຍັງໃຫ້ຕັ້ງ",
        });
        continue;
      }
    }

    out.push(base);
  }
  return out;
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManagePromotions(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການ ສ້າງ ໂປຣໂມຊັນ ໄດ້" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    name?: unknown;
    startAt?: unknown;
    endAt?: unknown;
    giftChoices?: unknown;
    dryRun?: unknown;
    replaceExisting?: unknown;
  } | null;

  const text = typeof body?.text === "string" ? body.text : "";
  if (text.trim() === "") {
    return NextResponse.json({ error: "ວາງຂໍ້ມູນຈາກໃບລາຄາກ່ອນ" }, { status: 400 });
  }

  const giftChoices: Record<string, string> = {};
  if (body?.giftChoices && typeof body.giftChoices === "object") {
    for (const [k, v] of Object.entries(
      body.giftChoices as Record<string, unknown>,
    )) {
      if (typeof v === "string" && v.trim()) giftChoices[k.trim()] = v.trim();
    }
  }

  const { rows, skipped } = parseSheet(text);
  const resolved = await resolve(rows, giftChoices);

  const dryRun = body?.dryRun !== false;
  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      skippedLines: skipped,
      rows: resolved,
    });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const startAt = typeof body?.startAt === "string" ? new Date(body.startAt) : null;
  const endAt = typeof body?.endAt === "string" ? new Date(body.endAt) : null;
  if (!name) {
    return NextResponse.json({ error: "ຕັ້ງຊື່ໃບໂປຣກ່ອນ" }, { status: 400 });
  }
  if (!startAt || Number.isNaN(startAt.getTime()) || !endAt || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: "ວັນທີເລີ່ມ/ສິ້ນສຸດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (endAt < startAt) {
    return NextResponse.json({ error: "ວັນສິ້ນສຸດຢູ່ກ່ອນວັນເລີ່ມ" }, { status: 400 });
  }

  const ready = resolved.filter((r) => r.status === "ok");
  if (ready.length === 0) {
    return NextResponse.json(
      { error: "ບໍ່ມີແຖວທີ່ພ້ອມສ້າງ — ແກ້ໄຂແຖວທີ່ຄ້າງກ່ອນ" },
      { status: 400 },
    );
  }

  const triggerCodes = ready.map((r) => r.itemCode);
  const created = await prisma.$transaction(async (tx) => {
    // A new sheet supersedes the last one. Two live promotions on the
    // same item is two prices for it, and the engine would apply both.
    if (body?.replaceExisting !== false) {
      await tx.appPromotion.updateMany({
        where: { isActive: true, triggerItemCode: { in: triggerCodes } },
        data: { isActive: false },
      });
    }
    const made = [];
    for (const r of ready) {
      made.push(
        await tx.appPromotion.create({
          data: {
            name: `${name} · ${r.itemName ?? r.itemCode}`,
            promoType: r.kind === "bogo" ? "bogo" : "fixed_price_period",
            isActive: true,
            startAt,
            endAt,
            triggerItemCode: r.itemCode,
            triggerQty: r.kind === "bogo" ? 1 : null,
            bonusItemCode: r.kind === "bogo" ? r.giftCode : null,
            bonusQty: r.kind === "bogo" ? 1 : null,
            // For a gift the trigger keeps its price — sheet price when
            // one is given, catalogue price otherwise — and the gift is
            // what costs nothing.
            bonusPriceKip:
              r.kind === "bogo"
                ? (r.specialPrice ?? r.catalogPrice ?? 0)
                : null,
            fixedPriceKip: r.kind === "bogo" ? null : r.specialPrice,
            awardsPoints: true,
            awardsMemberDiscount: false,
            note: r.giftText,
            createdBy: employee.employeeCode ?? null,
          },
        }),
      );
    }
    return made;
  });

  return NextResponse.json({
    created: created.length,
    skippedRows: resolved.length - ready.length,
    skippedLines: skipped,
  });
}
