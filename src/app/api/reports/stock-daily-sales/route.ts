import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canCreateRefillRequests, roleFromEmployee } from "@/lib/roles";
import {
  getConfiguredSalesWarehouses,
  STOCK_BALANCE_AS_OF_DATE,
} from "@/lib/inventory-config";

// GET /api/reports/stock-daily-sales?warehouse=1101&days=30
//
// What the shop actually sells day to day, with the stock behind it. The
// watchlist in ../stock-refill only knows about items someone has typed a
// (min, target) rule for, so it stays empty until that config is filled in.
// This one starts from the sales themselves: every item that moved in the
// window, its run-rate, and how many days the stock on hand still covers.
//
// Days of cover — stock ÷ average sold per day — is the ranking signal. It
// beats a raw "low stock" list because 3 pieces of something that sells once a
// month is fine, while 3 pieces of something that sells 5 a day is not.

type SoldRow = {
  item_code: string;
  item_name: string | null;
  unit_name: string | null;
  qty_sold: string | number | null;
  // COUNT() comes back as a BigInt over $queryRaw — never hand it to JSON.
  days_sold: bigint | number | null;
  last_sold: Date | null;
  current_stock: string | number | null;
  total_rows: bigint | number | null;
};

const ROW_LIMIT = 300;

const ALLOWED_WINDOWS = [7, 30, 90] as const;
const DEFAULT_WINDOW = 30;

// Sale lines that are not stock and can never be refilled. Without these the
// list is led by ບັດສ່ວນຫລຸດ / ຂອງແຖມ, which carry no balance and so pin
// themselves to the top as permanently "out of stock".
// ອຸປະກອນການຕະຫຼາດ stays in — those are physical items the shop holds.
const NON_STOCK_GROUPS = ["ບໍລິການ", "ຂອງແຖມ"];

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const warehouse = params.get("warehouse")?.trim() ?? "";
  const requestedDays = Number(params.get("days"));
  const days = (ALLOWED_WINDOWS as readonly number[]).includes(requestedDays)
    ? requestedDays
    : DEFAULT_WINDOW;

  // No warehouse picked → every active sales warehouse, matching what the
  // watchlist above treats as "stock we can sell from".
  const codes = warehouse ? [warehouse] : await getConfiguredSalesWarehouses();
  if (codes.length === 0) {
    return NextResponse.json({ warehouses: [], days, items: [], canCreate: false });
  }
  const codeList = Prisma.join(codes);
  const codeCsv = codes.join(",");

  const rows = await prisma.$queryRaw<SoldRow[]>`
    WITH sold AS (
      SELECT
        sd.item_code,
        MAX(sd.item_name)                 AS sale_item_name,
        SUM(sd.qty)                       AS qty_sold,
        COUNT(DISTINCT sd.doc_date::date) AS days_sold,
        MAX(sd.doc_date)::date            AS last_sold
      FROM odg_sale_detail sd
      WHERE sd.wh_code IN (${codeList})
        AND sd.doc_date >= CURRENT_DATE - ${days}::int
        -- 97xxxx service / fee pseudo-items (9701 ຕິດຕັ້ງ, 9702 ກວດເຊັກ,
        -- 9703 ຂົນສົ່ງ, 9704 ຮັບຝາກ) — same rule as saleBasis() applies to the
        -- sales figures. Money for a service, never stock to refill.
        AND sd.item_code NOT LIKE '97%'
        AND COALESCE(sd.itemmaingroup, '') NOT IN (${Prisma.join(NON_STOCK_GROUPS)})
      GROUP BY sd.item_code
      -- Net movement only. A month whose returns cancel out the sales tells us
      -- nothing about how fast the item runs down.
      HAVING SUM(sd.qty) > 0
    ),
    balance AS (
      SELECT ic_code, SUM(balance_qty) AS qty
      FROM public.sml_ic_function_stock_balance_warehouse(
        ${STOCK_BALANCE_AS_OF_DATE}::date,
        (SELECT string_agg(DISTINCT item_code, ',') FROM sold),
        ${codeCsv}
      )
      WHERE warehouse IN (${codeList})
      GROUP BY ic_code
    )
    SELECT
      s.item_code,
      COALESCE(NULLIF(TRIM(i.name_1), ''), s.sale_item_name) AS item_name,
      i.unit_standard_name                                   AS unit_name,
      s.qty_sold,
      s.days_sold,
      s.last_sold,
      COALESCE(b.qty, 0)                                     AS current_stock,
      -- How many items moved in total, so a truncated list can say so instead
      -- of reading as "only 300 items sold".
      COUNT(*) OVER ()                                       AS total_rows
    FROM sold s
    LEFT JOIN ic_inventory i ON i.code = s.item_code
    LEFT JOIN balance b      ON b.ic_code = s.item_code
    -- item_type 1 = ບໍລິການ in the item master. Belt-and-braces against a
    -- service line that was booked under a product group by mistake.
    WHERE COALESCE(i.item_type, 0) <> 1
    ORDER BY
      -- Out of stock first, then whatever runs out soonest. An item with stock
      -- but no measurable rate sorts last rather than first.
      (COALESCE(b.qty, 0) <= 0) DESC,
      COALESCE(b.qty, 0) / NULLIF(s.qty_sold / ${days}::numeric, 0) ASC NULLS LAST,
      s.qty_sold DESC
    LIMIT ${ROW_LIMIT}
  `;

  return NextResponse.json({
    warehouses: codes,
    days,
    total: Number(rows[0]?.total_rows ?? 0),
    canCreate: canCreateRefillRequests(roleFromEmployee(employee)),
    items: rows.map((row) => {
      const qtySold = toNumber(row.qty_sold);
      const currentStock = toNumber(row.current_stock);
      const avgPerDay = qtySold / days;
      const daysCover = avgPerDay > 0 ? currentStock / avgPerDay : null;
      const status =
        currentStock <= 0
          ? "out"
          : daysCover !== null && daysCover < 7
            ? "critical"
            : daysCover !== null && daysCover < 14
              ? "low"
              : "ok";
      return {
        itemCode: row.item_code,
        itemName: row.item_name?.trim() || row.item_code,
        unitName: row.unit_name?.trim() || null,
        qtySold,
        daysSold: Number(row.days_sold ?? 0),
        avgPerDay,
        currentStock,
        daysCover,
        // What it would take to get back to a two-week buffer — the number the
        // refill dialog opens with.
        suggestedQty: Math.max(0, Math.ceil(avgPerDay * 14 - currentStock)),
        lastSoldAt: row.last_sold,
        status,
      };
    }),
  });
}
