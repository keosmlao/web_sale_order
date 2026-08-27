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

// Serial-tracked units of one item standing in one warehouse, per the WMS
// serial ledger.
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

  // Availability comes from the WMS serial ledger, sn_trans_detail: a unit is
  // on hand when its movements sum to something other than zero
  // (qty × calc_flag, +1 in / −1 out). That is the rule the WMS's own
  // wms_check_sn_status view applies — the view hard-codes warehouse 1404, so
  // the rule is reused rather than the view.
  //
  // This matters. Against sn_inventory.status, which is what this endpoint
  // used first, the two answers agree on only 99 of about 700 serials in
  // 1101. The ledger is the one the WMS itself trusts.
  //
  // The ledger's own isn/location/rack are often blank, so those come from
  // sn_inventory wherever the ledger has none.
  const rows = await prisma.$queryRaw<Row[]>`
    WITH onhand AS (
      SELECT
        sn,
        (array_agg(isn ORDER BY roworder DESC))[1] AS isn,
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
      o.sn,
      COALESCE(NULLIF(o.isn, ''), i.isn) AS isn,
      COALESCE(NULLIF(o.location, ''), i.location) AS location,
      COALESCE(NULLIF(o.rack, ''), i.rack) AS rack
    FROM onhand o
    LEFT JOIN LATERAL (
      SELECT isn, location, rack
      FROM sn_inventory s
      WHERE s.sn = o.sn
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1
    ) i ON true
    ORDER BY COALESCE(NULLIF(o.isn, ''), i.isn, o.sn)
    LIMIT 500
  `;

  return NextResponse.json({
    items: rows
      .filter((r) => (r.sn ?? "").trim() !== "")
      .map((r) => ({
        sn: (r.sn ?? "").trim(),
        isn: (r.isn ?? "").trim() || null,
        location: (r.location ?? "").trim() || null,
        rack: (r.rack ?? "").trim() || null,
      })),
  });
}
