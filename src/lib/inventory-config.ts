import { prisma } from "@/lib/prisma";

// "ສິນຄ້າສຳລັບຂາຍ" — warehouse codes considered sales-available stock.
// SALES_WAREHOUSES is a bootstrap fallback; the Settings UI stores the live
// values in app_sales_warehouse.
const DEFAULT_SALES_WAREHOUSES = ["1101", "1102"];

export function getSalesWarehouses(): string[] {
  const raw = process.env.SALES_WAREHOUSES;
  if (!raw) return DEFAULT_SALES_WAREHOUSES;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : DEFAULT_SALES_WAREHOUSES;
}

type SalesWarehouseRow = {
  warehouse_code: string | null;
};

export async function getConfiguredSalesWarehouses(): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<SalesWarehouseRow[]>`
      SELECT warehouse_code
      FROM app_sales_warehouse
      WHERE is_active = TRUE
      ORDER BY warehouse_code
    `;
    const list = rows
      .map((row) => row.warehouse_code?.trim())
      .filter((code): code is string => !!code);
    return list.length > 0 ? list : getSalesWarehouses();
  } catch {
    return getSalesWarehouses();
  }
}

export const STOCK_BALANCE_AS_OF_DATE = "2099-12-31";
