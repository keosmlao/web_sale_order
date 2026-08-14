import { Prisma } from "@/generated/prisma/client";

/**
 * Quantity that earns incentive points for one sale-detail line.
 *
 * Split-system air conditioners are stored as an indoor [C] line and an
 * outdoor [H] line. The pair is one sellable set, so only the [C] line earns
 * points. Keeping this expression shared prevents the summary and its detail
 * endpoints from counting the same set differently.
 */
export function incentivePointQuantity(alias: string, pointmapCategory: Prisma.Sql): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`CASE
    WHEN ${pointmapCategory} = 'Air' AND ${t}.item_name ~ '\\[H\\]\\s*$' THEN 0
    ELSE ${t}.qty
  END`;
}

/**
 * List price used to choose the incentive price band.
 *
 * ERP sale detail stores a split-system air conditioner as equal-priced [C]
 * and [H] component lines. A document may contain repeated rows when more than
 * one set is sold. SUM() over all equal-priced lines therefore inflates two
 * sets to four component prices. Detecting the opposite component makes the
 * result exactly two component prices per set, regardless of repeated rows.
 * Standalone/portable units and unmatched components keep their own price.
 *
 * The management app's retail-incentive report (odgmgt-next
 * app/api/retail-incentive/route.js) still uses the SUM() spelling, so the two
 * reports disagree on bills that sell repeated identical sets — see
 * scripts/verify-retail-incentive-2026-07.mjs, which pins CAK26009303.
 */
export function incentiveBandPrice(alias: string, pointmapCategory: Prisma.Sql): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`CASE
    WHEN ${pointmapCategory} = 'Air'
      AND ${t}.item_name ~ '\\[[CH]\\]\\s*$'
      AND EXISTS (
        SELECT 1
        FROM odg_sale_detail incentive_pair
        WHERE incentive_pair.doc_no = ${t}.doc_no
          AND incentive_pair.branch_code IS NOT DISTINCT FROM ${t}.branch_code
          AND incentive_pair.salename IS NOT DISTINCT FROM ${t}.salename
          AND UPPER(COALESCE(incentive_pair.item_brand, '')) = UPPER(COALESCE(${t}.item_brand, ''))
          AND incentive_pair.qty IS NOT DISTINCT FROM ${t}.qty
          AND incentive_pair.price IS NOT DISTINCT FROM ${t}.price
          AND (
            (${t}.item_name ~ '\\[C\\]\\s*$' AND incentive_pair.item_name ~ '\\[H\\]\\s*$')
            OR
            (${t}.item_name ~ '\\[H\\]\\s*$' AND incentive_pair.item_name ~ '\\[C\\]\\s*$')
          )
      )
      THEN ${t}.price * 2
    ELSE ${t}.price
  END`;
}

/**
 * Washing-machine size band derived from the raw size_name.
 *
 * app_incentive_size_token is the primary source, but the ERP occasionally
 * introduces a new spelling (e.g. "10.0ກິໂລ") before it is added to the token
 * table, and an unmatched token silently drops the sale to zero points. Washer
 * rules are numeric kilogram bands, so the number in the name reproduces the
 * token exactly. Use as `COALESCE(stok.size_token, <this>)`.
 */
export function incentiveWasherSizeBand(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  const kg = Prisma.sql`(substring(replace(${t}.size_name, ',', '.') from '([0-9]+([.][0-9]+)?)'))::numeric`;
  return Prisma.sql`CASE
    WHEN ${kg} < 6 THEN '<5'
    WHEN ${kg} <= 11 THEN '6-11'
    WHEN ${kg} <= 14 THEN '12-14'
    WHEN ${kg} <= 19 THEN '15-19'
    WHEN ${kg} IS NOT NULL THEN '>20'
    ELSE ''
  END`;
}
