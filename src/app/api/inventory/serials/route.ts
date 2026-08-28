import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type Row = {
  isn: string | null;
  sn: string | null;
  location: string | null;
  rack: string | null;
};

// Serial-tracked units of one item standing in one warehouse.
//
// The two tables use the same word for different numbers, which cost a
// while to see:
//
//   sn_trans_detail.sn  — ODIEN's own tag, "009A0002317". The movement
//                         ledger tracks this. It is the ISN.
//   sn_inventory.isn    — the same number, under its real name.
//   sn_inventory.sn     — the factory serial, "990115100194240000240401".
//
// Joining sn to sn matched 120 of the 852 units standing in warehouse
// 1101. Joining the ledger's sn to sn_inventory.isn matches 807. So the
// ledger's "sn" is the ISN, and the endpoint says so rather than passing
// the confusion on.
//
// The counter is given the ISN first — it is what the storefront's
// paperwork goes by and what is written on the unit's own label — with
// the factory serial behind it for anything the ISN cannot answer.
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

  // On hand is still the ledger's own rule — movements summing to
  // something other than zero — because that is what the WMS itself
  // applies. sn_inventory.status agrees with it (762 of the 779 rows it
  // marks status 0 in warehouse 1101 are on hand, against 21 of the 4,082
  // it marks 1) but the ledger is the one that settles a sale.
  const rows = await prisma.$queryRaw<Row[]>`
    WITH onhand AS (
      SELECT
        sn AS isn,
        (array_agg(location ORDER BY roworder DESC))[1] AS location,
        (array_agg(rack ORDER BY roworder DESC))[1] AS rack
      FROM sn_trans_detail
      WHERE item_code = ${code}
        AND (${warehouse} = '' OR warehouse = ${warehouse})
        AND COALESCE(sn, '') <> ''
      GROUP BY sn
      HAVING SUM(qty * calc_flag::numeric) <> 0
    )
    SELECT
      o.isn,
      NULLIF(TRIM(i.sn), '') AS sn,
      COALESCE(NULLIF(o.location, ''), i.location) AS location,
      COALESCE(NULLIF(o.rack, ''), i.rack) AS rack
    FROM onhand o
    LEFT JOIN LATERAL (
      SELECT s.sn, s.location, s.rack
      FROM sn_inventory s
      WHERE s.isn = o.isn
        AND (${warehouse} = '' OR s.wh_code = ${warehouse})
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1
    ) i ON true
    ORDER BY o.isn
    LIMIT 500
  `;

  return NextResponse.json({
    items: rows
      .filter((r) => (r.isn ?? "").trim() !== "")
      .map((r) => ({
        isn: (r.isn ?? "").trim(),
        sn: (r.sn ?? "").trim() || null,
        location: (r.location ?? "").trim() || null,
        rack: (r.rack ?? "").trim() || null,
      })),
  });
}
