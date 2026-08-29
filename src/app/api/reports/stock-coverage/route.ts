import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getConfiguredSalesWarehouses } from "@/lib/inventory-config";

// /api/reports/stock-coverage — ວິເຄາະຄວາມພຽງພໍ (coverage analysis).
//
//   ?wh=1101&days=90&crit=7&reorder=14&excess=60
//
// For one warehouse: every item that either sold in the window or sits on
// the shelf now, with its live balance, sales velocity, days of cover and
// a bucket:
//   out      — balance 0 but it sells         (ໝົດ)
//   critical — cover < crit days              (ວິກິດ)
//   reorder  — cover < reorder days           (ສັ່ງຊື້)
//   ok       — cover ≤ excess days            (ພຽງພໍ)
//   excess   — cover > excess days            (ເກີນ)
//   idle     — stock but no sales             (ບໍ່ເຄື່ອນໄຫວ)
// Refill quantity tops the item back up to `reorder` days of sales; its
// value is priced at ic_inventory.unit_cost (THB base), same for the
// sunk-stock value of excess/idle.

type SalesRow = {
  item_code: string;
  sold: string | number;
  last_sale: Date | null;
  bills: number;
};
type BalRow = { ic_code: string; qty: string | number };
type InfoRow = {
  code: string;
  name_1: string | null;
  unit_standard_name: string | null;
  unit_cost: string | number | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const warehouses = await getConfiguredSalesWarehouses();
  const wh = (sp.get("wh") ?? "").trim() || warehouses[0];
  const days = Math.min(365, Math.max(7, Number(sp.get("days")) || 90));
  const crit = Math.max(1, Number(sp.get("crit")) || 7);
  const reorder = Math.max(crit, Number(sp.get("reorder")) || 14);
  const excess = Math.max(reorder, Number(sp.get("excess")) || 60);

  const whNames = await prisma.$queryRaw<Array<{ code: string; name_1: string | null }>>`
    SELECT code, name_1 FROM ic_warehouse WHERE code = ANY(${warehouses})
  `;

  const [sales, balances] = await Promise.all([
    prisma.$queryRaw<SalesRow[]>`
      SELECT d.item_code,
             SUM(d.qty) AS sold,
             MAX(d.doc_date) AS last_sale,
             COUNT(DISTINCT d.doc_no)::int AS bills
      FROM ic_trans_detail d
      WHERE d.trans_flag = 44
        AND d.wh_code = ${wh}
        AND d.doc_date >= CURRENT_DATE - ${days}::int
        AND d.item_code NOT LIKE '97%'
      GROUP BY d.item_code
    `,
    prisma.$queryRaw<BalRow[]>`
      SELECT ic_code, SUM(balance_qty) AS qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        CURRENT_DATE,
        (SELECT string_agg(code, ',') FROM ic_inventory
         WHERE name_1 IS NOT NULL AND COALESCE(balance_qty, 0) > 0),
        ${wh}
      )
      GROUP BY ic_code
      HAVING SUM(balance_qty) > 0
    `,
  ]);

  const balByCode = new Map(balances.map((b) => [b.ic_code, Number(b.qty)]));
  const salesByCode = new Map(sales.map((r) => [r.item_code, r]));
  const codes = [...new Set([...balByCode.keys(), ...salesByCode.keys()])];

  const info = codes.length
    ? await prisma.$queryRaw<InfoRow[]>`
        SELECT code, name_1, unit_standard_name, unit_cost
        FROM ic_inventory WHERE code = ANY(${codes})
      `
    : [];
  const infoByCode = new Map(info.map((i) => [i.code, i]));

  type Item = {
    code: string;
    name: string;
    unit: string;
    balance: number;
    sold: number;
    bills: number;
    lastSale: string | null;
    avgDay: number;
    coverDays: number | null;
    status: "out" | "critical" | "reorder" | "ok" | "excess" | "idle";
    refillQty: number;
    refillValue: number;
    stockValue: number;
  };

  const items: Item[] = codes.map((code) => {
    const i = infoByCode.get(code);
    const s = salesByCode.get(code);
    const balance = balByCode.get(code) ?? 0;
    const sold = s ? Number(s.sold) : 0;
    const avgDay = sold > 0 ? sold / days : 0;
    const coverDays = avgDay > 0 ? balance / avgDay : null;
    const rawCost = i?.unit_cost ? Number(i.unit_cost) : 0;
    // A malformed unit_cost turned one addend NaN and the whole day's
    // refill total into null. Money maths only over finite numbers.
    const cost = Number.isFinite(rawCost) ? rawCost : 0;
    let status: Item["status"];
    if (sold > 0 && balance <= 0) status = "out";
    else if (avgDay > 0 && (coverDays ?? 0) < crit) status = "critical";
    else if (avgDay > 0 && (coverDays ?? 0) < reorder) status = "reorder";
    else if (avgDay > 0 && (coverDays ?? 0) <= excess) status = "ok";
    else if (avgDay > 0) status = "excess";
    else status = "idle";
    const refillQty =
      status === "out" || status === "critical" || status === "reorder"
        ? Math.max(0, Math.ceil(avgDay * reorder - balance))
        : 0;
    return {
      code,
      name: i?.name_1 ?? code,
      unit: i?.unit_standard_name ?? "",
      balance,
      sold,
      bills: s?.bills ?? 0,
      lastSale: s?.last_sale ? s.last_sale.toISOString().slice(0, 10) : null,
      avgDay: Math.round(avgDay * 100) / 100,
      coverDays: coverDays === null ? null : Math.round(coverDays * 10) / 10,
      status,
      refillQty,
      refillValue: Math.round(refillQty * cost),
      stockValue: Math.round(balance * cost),
    };
  });

  const rank: Record<Item["status"], number> = {
    out: 0,
    critical: 1,
    reorder: 2,
    ok: 3,
    excess: 4,
    idle: 5,
  };
  items.sort(
    (a, b) => rank[a.status] - rank[b.status] || b.refillValue - a.refillValue || b.stockValue - a.stockValue,
  );

  const count = (st: Item["status"]) => items.filter((x) => x.status === st).length;
  const summary = {
    total: items.length,
    out: count("out"),
    critical: count("critical"),
    reorder: count("reorder"),
    ok: count("ok"),
    excess: count("excess"),
    idle: count("idle"),
    refillValue: items.reduce((a, x) => a + x.refillValue, 0),
    sunkValue: items
      .filter((x) => x.status === "excess" || x.status === "idle")
      .reduce((a, x) => a + x.stockValue, 0),
  };

  return NextResponse.json({
    wh,
    days,
    crit,
    reorder,
    excess,
    warehouses: warehouses.map((code) => ({
      code,
      name: whNames.find((w) => w.code === code)?.name_1 ?? code,
    })),
    summary,
    items,
  });
}
