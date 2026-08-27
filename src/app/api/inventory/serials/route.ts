import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type Row = {
  sn: string | null;
  isn: string | null;
  location: string | null;
  rack: string | null;
};

// Serial-tracked units of one item standing in one warehouse.
//
// status tells on-hand from gone: in 1101 the 646 items carrying status-0
// serials line up with the balance function 97% of the time, against 39%
// for status 1. So 0 is on the shelf and 1 has left the building; only the
// former can be sold.
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const code = (params.get("code") ?? "").trim();
  const warehouse = (params.get("warehouse") ?? "").trim();
  if (!code) {
    return NextResponse.json({ items: [] });
  }

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT sn, isn, location, rack
    FROM sn_inventory
    WHERE item_code = ${code}
      AND COALESCE(status, 0) = 0
      AND COALESCE(qty, 0) > 0
      AND (${warehouse} = '' OR wh_code = ${warehouse})
    ORDER BY COALESCE(NULLIF(isn, ''), sn)
    LIMIT 500
  `;

  return NextResponse.json({
    // Some units carry an ISN with no SN. They are still one identifiable
    // unit on the shelf, so a row counts as long as it has either.
    items: rows
      .filter((r) => ((r.sn ?? "").trim() || (r.isn ?? "").trim()) !== "")
      .map((r) => ({
        sn: (r.sn ?? "").trim(),
        isn: (r.isn ?? "").trim() || null,
        location: (r.location ?? "").trim() || null,
        rack: (r.rack ?? "").trim() || null,
      })),
  });
}
