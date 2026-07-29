import { Prisma } from "@/generated/prisma/client";

// How the branch's own "ສະຫລຸບຍອດຂາຍ ODG" workbook scopes storefront sales.
// Any figure compared against a monthly retail target has to be built the same
// way, otherwise the app reads higher than the report managers actually use.
//
// Verified against report-pivot-retail-27072026.xlsx (July 2026, through the
// 26th): branch 01 + argroup 101 with the three rules below reproduces the
// workbook's 8,647,241 exactly.

// Product groups (odg_sale_detail.itemmaingroup) the targets are set against —
// CCO (ແອ), CE (ເຄື່ອງໃຊ້ໄຟຟ້າພາຍໃນບ້ານ) and SDA (ປະປາ ໄຟຟ້າ …).
// ອາໄຫຼ່ (spare parts, ~1.5M/month) and ບໍລິການ (service charges) carry no
// target and are excluded.
export const TARGET_ITEM_MAIN_GROUPS = [
  "ແອ",
  "ເຄື່ອງໃຊ້ໄຟຟ້າພາຍໃນບ້ານ",
  "ປະປາ ໄຟຟ້າ ອຸປະກອນກໍ່ສ້າງ ກະເສດ",
] as const;

// Online orders are a separate channel with their own target and are kept out
// of the storefront figure (~379k in July 2026).
export const EXCLUDED_SALE_GROUP = "ONLINE";

// Internal / staff-POS document formats that the workbook leaves out.
// Sales bills (CAK, INK) and credit notes (CNK) stay in.
export const EXCLUDED_DOC_FORMATS = ["SPOS", "CAKSP"] as const;

// The three rules as a WHERE fragment, so every target-facing query applies the
// same scope instead of spelling it out again. `alias` is the odg_sale_detail
// alias at the call site (a literal in our own SQL, never user input).
//
// Callers still supply branch_code / argroup_main / date themselves — those
// vary by report; this covers only what the target scope adds.
export function targetSalesScope(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`
    AND ${t}.itemmaingroup IN (${Prisma.join([...TARGET_ITEM_MAIN_GROUPS])})
    AND COALESCE(${t}.sale_group_name, '') <> ${EXCLUDED_SALE_GROUP}
    AND ${t}.doc_format_code NOT IN (${Prisma.join([...EXCLUDED_DOC_FORMATS])})
  `;
}
