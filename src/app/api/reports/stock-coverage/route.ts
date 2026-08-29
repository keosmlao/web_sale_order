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
  revenue: string | number | null;
  last_sale: Date | null;
  bills: number;
};
type WmsRow = { item_code: string; qty: string | number };
type MinRow = {
  item_code: string;
  min_qty: string | number;
  target_qty: string | number;
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

  const [sales, balances, wmsRows, minRows] = await Promise.all([
    prisma.$queryRaw<SalesRow[]>`
      SELECT d.item_code,
             SUM(d.qty) AS sold,
             SUM(d.sum_amount_2) AS revenue,
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
    // The WMS's own view of the same shelf — SUM(qty × calc_flag), the
    // exact arithmetic its balance screens use. Where the two ledgers
    // disagree the buyer should count before ordering.
    prisma.$queryRaw<WmsRow[]>`
      SELECT item_code, SUM(qty * calc_flag) AS qty
      FROM odg_wms_trans_detail
      WHERE wh_code = ${wh}
      GROUP BY item_code
    `.catch(() => [] as WmsRow[]),
    // Hand-set floors from /settings/stock-minimum: where someone has
    // decided this shelf must never drop below min and refills aim at
    // target, the analysis honours the decision over pure velocity.
    prisma.$queryRaw<MinRow[]>`
      SELECT item_code, min_qty, target_qty
      FROM app_stock_minimum
      WHERE warehouse_code = ${wh}
    `.catch(() => [] as MinRow[]),
  ]);
  const wmsByCode = new Map(wmsRows.map((w) => [w.item_code, Number(w.qty)]));
  const minByCode = new Map(
    minRows.map((m) => [
      m.item_code,
      { min: Number(m.min_qty), target: Number(m.target_qty) },
    ]),
  );

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
    revenue: number;
    minQty: number | null;
    targetQty: number | null;
    abc: "A" | "B" | "C" | null;
    fsn: "F" | "S" | "N";
    wmsQty: number | null;
    wmsDiff: boolean;
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
    const floor = minByCode.get(code);
    let status: Item["status"];
    if (sold > 0 && balance <= 0) status = "out";
    else if (floor && floor.min > 0 && balance < floor.min)
      // Below the hand-set floor is critical regardless of how the
      // velocity maths reads it.
      status = "critical";
    else if (avgDay > 0 && (coverDays ?? 0) < crit) status = "critical";
    else if (avgDay > 0 && (coverDays ?? 0) < reorder) status = "reorder";
    else if (avgDay > 0 && (coverDays ?? 0) <= excess) status = "ok";
    else if (avgDay > 0) status = "excess";
    else if (floor && floor.min > 0 && balance < floor.min) status = "critical";
    else status = "idle";
    const velocityRefill = Math.max(0, Math.ceil(avgDay * reorder - balance));
    const targetRefill =
      floor && floor.target > 0 ? Math.max(0, Math.ceil(floor.target - balance)) : 0;
    const refillQty =
      status === "out" || status === "critical" || status === "reorder"
        ? Math.max(velocityRefill, targetRefill)
        : targetRefill;
    // FSN by recency of the last sale: Fast within 30 days, Slow within
    // the window, Non-moving never sold in it.
    const lastSaleAge = s?.last_sale
      ? (Date.now() - s.last_sale.getTime()) / 86400_000
      : null;
    const fsn: "F" | "S" | "N" =
      lastSaleAge === null ? "N" : lastSaleAge <= 30 ? "F" : "S";
    const revenueRaw = s?.revenue ? Number(s.revenue) : 0;
    const wmsQty = wmsByCode.has(code) ? wmsByCode.get(code)! : null;
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
      revenue: Number.isFinite(revenueRaw) ? Math.round(revenueRaw) : 0,
      minQty: floor ? floor.min : null,
      targetQty: floor ? floor.target : null,
      abc: null,
      fsn,
      wmsQty,
      wmsDiff: wmsQty !== null && Math.abs(wmsQty - balance) > 0.01,
    };
  });

  // ABC over the sellers: A carries the first 80% of the window's revenue,
  // B to 95%, C the tail. Non-sellers stay unclassed.
  {
    const sellers = items
      .filter((x) => x.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
    const totalRev = sellers.reduce((a, x) => a + x.revenue, 0);
    let cum = 0;
    for (const x of sellers) {
      cum += x.revenue;
      x.abc = totalRev > 0 ? (cum <= totalRev * 0.8 ? "A" : cum <= totalRev * 0.95 ? "B" : "C") : "C";
    }
  }

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
  const selling = items.filter((x) => x.sold > 0).length;
  const short = items.filter(
    (x) => x.status === "out" || x.status === "critical" || x.status === "reorder",
  ).length;
  const wmsCompared = items.filter((x) => x.wmsQty !== null).length;
  const wmsMismatch = items.filter((x) => x.wmsDiff).length;
  const summary = {
    total: items.length,
    selling,
    // Of the items that actually sell, how many the shelf can serve today.
    fillRate: selling > 0 ? Math.round(((selling - short) / selling) * 100) : 100,
    wmsCompared,
    wmsMismatch,
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
