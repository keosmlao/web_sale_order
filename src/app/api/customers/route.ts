import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canCreateCustomers, roleFromEmployee } from "@/lib/roles";

type CustomerRow = {
  code: string;
  name_1: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
  group_code: string | null;
  group_name: string | null;
  discount_raw: string | null;
  point_balance: string | number | null;
};

function parseDiscountPct(raw: string | null): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.-]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parsePointBalance(raw: string | number | null): number {
  if (raw === null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function toCustomer(row: CustomerRow) {
  const name = row.name_1?.trim() || row.code.trim();
  const phone = row.telephone?.trim() || null;
  const email = row.email?.trim() || null;
  const address = row.address?.trim() || null;
  const groupCode = row.group_code?.trim() || null;
  const groupName = row.group_name?.trim() || null;
  const discountPct = parseDiscountPct(row.discount_raw);
  const pointBalance = parsePointBalance(row.point_balance);
  return {
    id: row.code.trim(),
    name,
    phone,
    email,
    address,
    groupCode,
    groupName,
    discountPct,
    pointBalance,
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  // Caps: when the caller searches we only need enough rows to render a
  // dropdown (200 is plenty). When listing without a query the mobile app
  // does its own client-side filter, so we have to return the full member
  // book — capped at 20 000 to protect the server from a runaway table.
  const defaultLimit = q ? 80 : 20000;
  const maxLimit = q ? 200 : 20000;
  const limitRaw = Number(
    request.nextUrl.searchParams.get("limit") ?? defaultLimit,
  );
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.floor(limitRaw), 1), maxLimit)
    : defaultLimit;

  if (q) {
    const pattern = `%${q}%`;
    const customers = await prisma.$queryRaw<CustomerRow[]>`
      SELECT
        ar.code,
        ar.name_1,
        ar.telephone,
        ar.email,
        ar.address,
        d.group_sub_1 AS group_code,
        g.name_1 AS group_name,
        NULLIF(d.discount_item, '') AS discount_raw,
        ar.point_balance
      FROM ar_customer ar
      LEFT JOIN ar_customer_detail d ON d.ar_code = ar.code
      LEFT JOIN ar_group_sub g ON g.code = d.group_sub_1
      WHERE LOWER(TRIM(COALESCE(ar.reg_group, ''))) = 'member'
        AND NULLIF(TRIM(ar.code), '') IS NOT NULL
        AND (
          ar.code ILIKE ${pattern}
          OR COALESCE(ar.name_1, '') ILIKE ${pattern}
          OR COALESCE(ar.telephone, '') ILIKE ${pattern}
          OR COALESCE(ar.email, '') ILIKE ${pattern}
          OR COALESCE(ar.address, '') ILIKE ${pattern}
        )
      ORDER BY TRIM(COALESCE(ar.name_1, ar.code))
      LIMIT ${limit}
    `;

    return NextResponse.json(customers.map(toCustomer));
  }

  const customers = await prisma.$queryRaw<CustomerRow[]>`
    SELECT
      ar.code,
      ar.name_1,
      ar.telephone,
      ar.email,
      ar.address,
      d.group_sub_1 AS group_code,
      g.name_1 AS group_name,
      NULLIF(d.discount_item, '') AS discount_raw,
      ar.point_balance
    FROM ar_customer ar
    LEFT JOIN ar_customer_detail d ON d.ar_code = ar.code
    LEFT JOIN ar_group_sub g ON g.code = d.group_sub_1
    WHERE LOWER(TRIM(COALESCE(ar.reg_group, ''))) = 'member'
      AND NULLIF(TRIM(ar.code), '') IS NOT NULL
    ORDER BY TRIM(COALESCE(ar.name_1, ar.code))
    LIMIT ${limit}
  `;

  return NextResponse.json(customers.map(toCustomer));
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canCreateCustomers(roleFromEmployee(employee))) {
    return NextResponse.json(
      { error: "ສະເພາະຫົວໜ້າ ຫຼື ຜູ້ຈັດການ ສ້າງລູກຄ້າໃໝ່ໄດ້" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  // Phone is required and doubles as the customer code, so we strip every
  // non-digit (spaces, hyphens, parentheses) before validating.
  const phoneRaw =
    typeof body?.phone === "string" ? body.phone.trim() : "";
  const phone = phoneRaw.replace(/\D+/g, "");
  const email =
    typeof body?.email === "string" && body.email.trim()
      ? body.email.trim()
      : null;
  const address =
    typeof body?.address === "string" && body.address.trim()
      ? body.address.trim()
      : null;

  // Member type decides whether the customer gets a loyalty tier + discount:
  //   "general"  → ສະມາຊິກທົ່ວໄປ: no tier, no discount (no ar_customer_detail row)
  //   "line_oa"  → ສະມາຊິກ LINE O.A: gold tier + 3% line discount (legacy default)
  // Any missing/unknown value falls back to "line_oa" so existing callers
  // (e.g. the mobile app) that don't send the field keep their old behaviour.
  const memberType =
    typeof body?.memberType === "string" &&
    body.memberType.trim().toLowerCase() === "general"
      ? "general"
      : "line_oa";

  if (!name) {
    return NextResponse.json({ error: "ກະລຸນາໃສ່ຊື່ລູກຄ້າ" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "ກະລຸນາໃສ່ເບີໂທ" }, { status: 400 });
  }
  // Lao mobile numbering — 20-prefix carriers (Unitel, ETL, Beeline, ...)
  // ship 10-digit numbers; 30-prefix (LTC) ship 9-digit. Anything else is
  // rejected at the door so the customer code (which we set to the phone)
  // stays in a predictable shape.
  const valid20 = /^20\d{8}$/.test(phone); // 10 digits total
  const valid30 = /^30\d{7}$/.test(phone); // 9 digits total
  if (!valid20 && !valid30) {
    return NextResponse.json(
      {
        error:
          "ເບີໂທບໍ່ຖືກຮູບແບບ: ຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ 20 (10 ຕົວ) ຫຼື 30 (9 ຕົວ)",
      },
      { status: 400 },
    );
  }

  // The phone number IS the customer code — no more APP-C{timestamp}. This
  // gives reception a stable, human-friendly key on the receipts.
  const code = phone;

  // Duplicate guard: reject if any existing ar_customer row already uses
  // this phone (or has this code from a previous registration).
  const dupRows = await prisma.$queryRaw<Array<{ code: string }>>`
    SELECT code FROM ar_customer
    WHERE code = ${code}
       OR REGEXP_REPLACE(COALESCE(telephone, ''), '\D', '', 'g') = ${phone}
    LIMIT 1
  `;
  if (dupRows.length > 0) {
    return NextResponse.json(
      {
        error: `ເບີໂທນີ້ມີລູກຄ້າແລ້ວ (${dupRows[0].code})`,
      },
      { status: 409 },
    );
  }

  // LINE O.A members get the "gold" tier with a 3% line discount; general
  // members (ສະມາຊິກທົ່ວໄປ) get no tier at all, so we only resolve gold when
  // the type calls for it. Resolution is tolerant — we match against both
  // name_1 and code with ILIKE '%gold%' so renames / Lao localisations / case
  // mismatches still find the row. Exact "gold" wins; anything else is a
  // best-effort fallback.
  let goldCode: string | null = null;
  let goldName: string | null = null;
  const defaultDiscount = "3";
  if (memberType === "line_oa") {
    const goldRows = await prisma.$queryRaw<
      Array<{ code: string; name_1: string | null; rank: number }>
    >`
      SELECT
        code,
        name_1,
        CASE
          WHEN LOWER(TRIM(COALESCE(name_1, ''))) = 'gold' THEN 0
          WHEN LOWER(TRIM(COALESCE(code, '')))   = 'gold' THEN 1
          WHEN LOWER(COALESCE(name_1, ''))       LIKE '%gold%' THEN 2
          WHEN LOWER(COALESCE(code, ''))         LIKE '%gold%' THEN 3
          ELSE 99
        END AS rank
      FROM ar_group_sub
      WHERE
        LOWER(COALESCE(name_1, '')) LIKE '%gold%'
        OR LOWER(COALESCE(code, '')) LIKE '%gold%'
      ORDER BY rank, code
      LIMIT 1
    `;
    goldCode = goldRows[0]?.code?.trim() || null;
    goldName = goldRows[0]?.name_1?.trim() || null;
  }
  if (memberType === "line_oa" && !goldCode) {
    console.warn(
      "[customers] no 'gold' tier matched in ar_group_sub — verify ar_group_sub has a row whose code or name_1 contains 'gold'.",
    );
  } else if (goldCode) {
    console.log(
      `[customers] resolved gold tier: code=${goldCode} name=${goldName ?? "(null)"}`,
    );
  }

  // reg_group='member' is required: GET /api/customers filters by it AND POST
  // /api/orders rejects non-member customers. Without it the new customer
  // would be invisible and unusable for orders.
  const inserted = await prisma.$transaction(async (tx) => {
    const arRows = await tx.$queryRaw<
      Array<{
        code: string;
        name_1: string | null;
        telephone: string | null;
        email: string | null;
        address: string | null;
      }>
    >`
      INSERT INTO ar_customer (code, name_1, telephone, email, address, reg_group)
      VALUES (${code}, ${name}, ${phone}, ${email}, ${address}, 'member')
      RETURNING code, name_1, telephone, email, address
    `;

    // Only write the detail row when we have a tier to assign. Without
    // group_sub_1 the row is mostly meaningless and would block future
    // updates if ar_code is the PK.
    if (goldCode) {
      try {
        // First try INSERT … ON CONFLICT — works when ar_code is a PK or has
        // a UNIQUE constraint (most SML deployments).
        await tx.$executeRaw`
          INSERT INTO ar_customer_detail (ar_code, group_sub_1, discount_item)
          VALUES (${code}, ${goldCode}, ${defaultDiscount})
          ON CONFLICT (ar_code) DO UPDATE
            SET group_sub_1 = EXCLUDED.group_sub_1,
                discount_item = EXCLUDED.discount_item
        `;
      } catch (e) {
        // Some legacy SML schemas don't have a UNIQUE constraint on ar_code
        // so ON CONFLICT throws "42P10". Fall back to a plain INSERT — for a
        // brand-new customer there can't be an existing row anyway.
        const code42 = (e as { code?: string })?.code;
        if (code42 === "42P10" || code42 === "P2010") {
          await tx.$executeRaw`
            INSERT INTO ar_customer_detail (ar_code, group_sub_1, discount_item)
            VALUES (${code}, ${goldCode}, ${defaultDiscount})
          `;
        } else {
          throw e;
        }
      }
    }
    return arRows[0];
  });

  return NextResponse.json(
    toCustomer({
      ...inserted,
      group_code: goldCode,
      group_name: goldName,
      discount_raw: goldCode ? defaultDiscount : null,
      point_balance: 0,
    }),
    { status: 201 },
  );
}
