import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Look a coupon up by the number printed on it, so the cashier can see what
// it is worth before putting it on the bill.
//
// This only reads. Nothing is held, reserved or deducted here — the balance
// comes off in the settle transaction, under the same lock as the rest of
// the bill. A coupon looked up twice in two tills is still one coupon, and
// whichever bill saves first gets it.
export const dynamic = "force-dynamic";

type Row = {
  number: string;
  amount: string | number | null;
  balance_amount: string | number | null;
  last_status: number | null;
  date_expire: Date | null;
  cust_code: string | null;
  single_use: number | null;
  coupon_group: string | null;
};

export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const number = (request.nextUrl.searchParams.get("number") ?? "").trim();
  if (!number) {
    return NextResponse.json({ error: "ບໍ່ມີເລກ coupon" }, { status: 400 });
  }

  // The numbers on the physical coupons carry spaces ("MKT 01"), and a
  // scanner or a tired hand will not reproduce them exactly. Match on the
  // number with whitespace and case taken out of the question.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT number, amount, balance_amount, last_status, date_expire,
           cust_code, single_use, coupon_group
    FROM coupon_list
    WHERE UPPER(REPLACE(number, ' ', '')) = UPPER(REPLACE(${number}, ' ', ''))
    ORDER BY create_date_time_now DESC NULLS LAST
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { error: `ບໍ່ພົບ coupon ເລກ ${number}` },
      { status: 404 },
    );
  }

  const balance = Number(row.balance_amount ?? 0);
  const expired = row.date_expire ? row.date_expire.getTime() < Date.now() : false;
  // last_status is the WMS's own "spent" flag; 0 is live.
  const spent = Number(row.last_status ?? 0) !== 0;

  // Say what is wrong rather than just refusing — the cashier has a customer
  // in front of them holding the thing.
  const problem = spent
    ? "ໃບນີ້ຖືກໃຊ້ໄປແລ້ວ"
    : expired
      ? "ໃບນີ້ໝົດອາຍຸແລ້ວ"
      : balance <= 0
        ? "ໃບນີ້ບໍ່ມີຍອດເຫຼືອ"
        : null;

  return NextResponse.json(
    {
      number: row.number.trim(),
      amount: Number(row.amount ?? 0),
      balance,
      expiresAt: row.date_expire?.toISOString() ?? null,
      // Set when the coupon was issued to one customer. The UI warns if the
      // bill is for somebody else; it does not refuse, because the counter
      // sometimes knows more than the record does.
      custCode: row.cust_code?.trim() || null,
      group: row.coupon_group?.trim() || null,
      usable: problem === null,
      problem,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
