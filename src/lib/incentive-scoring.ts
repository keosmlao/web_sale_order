import { Prisma } from "@/generated/prisma/client";
import { saleReportDate } from "@/lib/sale-month";

/**
 * The other half of a split air-conditioner set, and what it sold for — NULL
 * when the line is not one half of a pair on this bill.
 *
 * The two halves are separate item codes with separate model numbers
 * (FTKQ12XV2S beside RKQ12XV2S), so they are matched on the bill, the seller,
 * the brand and the quantity — everything except the name, which differs by
 * design. The nearest item code wins, because a set's two components are
 * catalogued next to each other, which is what keeps two sets of the same brand
 * on one bill from crossing over.
 *
 * Deliberately NOT matched on equal price: the halves of one set are usually
 * priced the same, but a set discounted on one component is still one set, and
 * requiring equality would leave both halves unpaired and band each on its own
 * component price.
 *
 * Spelled exactly as the management app's scoring query (odgmgt-next
 * lib/incentive-points-sql.js), so both apps read a split set the same way.
 */
export function incentiveMatePrice(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`(
    SELECT incentive_pair.sum_amount
    FROM odg_sale_detail incentive_pair
    WHERE incentive_pair.doc_no = ${t}.doc_no
      AND incentive_pair.branch_code IS NOT DISTINCT FROM ${t}.branch_code
      AND incentive_pair.salename IS NOT DISTINCT FROM ${t}.salename
      AND UPPER(COALESCE(incentive_pair.item_brand, '')) = UPPER(COALESCE(${t}.item_brand, ''))
      AND incentive_pair.qty IS NOT DISTINCT FROM ${t}.qty
      AND (
        (${t}.item_name ~ '\\[C\\]\\s*$' AND incentive_pair.item_name ~ '\\[H\\]\\s*$')
        OR
        (${t}.item_name ~ '\\[H\\]\\s*$' AND incentive_pair.item_name ~ '\\[C\\]\\s*$')
      )
    ORDER BY abs(
      COALESCE(NULLIF(regexp_replace(incentive_pair.item_code, '\\D', '', 'g'), ''), '0')::bigint
      - COALESCE(NULLIF(regexp_replace(${t}.item_code, '\\D', '', 'g'), ''), '0')::bigint
    ) ASC
    LIMIT 1
  )`;
}

/**
 * Quantity that earns incentive points for one sale-detail line.
 *
 * Split-system air conditioners are stored as an indoor [C] line and an
 * outdoor [H] line. The pair is one sellable set, so only the [C] line earns
 * points. Keeping this expression shared prevents the summary and its detail
 * endpoints from counting the same set differently.
 *
 * An outdoor half with no indoor half on the bill — an outdoor unit sold on its
 * own, or a set split across two bills — scores itself: nothing else is going
 * to score it, and zeroing it would drop a real sale out of the scheme.
 *
 * @param hasMate boolean expression saying whether this line found its other
 *   half. It is a parameter rather than a lookup here because the summary asks
 *   this question one derived table further out than incentiveMatePrice() can
 *   reach — the sale columns it correlates on are no longer in scope there.
 */
export function incentivePointQuantity(
  alias: string,
  pointmapCategory: Prisma.Sql,
  hasMate: Prisma.Sql,
): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`CASE
    WHEN ${pointmapCategory} = 'Air'
      AND ${t}.item_name ~ '\\[H\\]\\s*$'
      AND ${hasMate}
      THEN 0
    ELSE ${t}.qty
  END`;
}

/**
 * What fraction of a bill's air-conditioner takings is ຄ່າຕິດຕັ້ງ.
 *
 * The denominator is every air line's ຍອດຂາຍ, both halves of every set: summed
 * that way it is exactly the total of the set values the bands are read
 * against, without having to resolve each set's other half a second time.
 * Multiplying it back per set spreads the charge in proportion to what each set
 * fetched — installation is billed per unit at a price set by BTU class, and a
 * bigger unit is both worth more and costs more to fit — and leaves the whole
 * charge accounted for and no more.
 *
 * 9701xx is ຕິດຕັ້ງ (both the air-conditioner and the appliance codes).
 * 9702 ກວດເຊັກ, 9703 ຂົນສົ່ງ and 9704 ຮັບຝາກ are services bought alongside the
 * machine, not part of getting it working, and stay out.
 *
 * The charge taken off is the PRICE LIST cost of fitting, not the figure
 * printed on the bill. A bill discounts the whole basket, the fitting line with
 * it, so the billed figure understates what the work costs and leaves part of
 * it sitting inside the machine's value. ic_inventory_price holds the branch's
 * own THB price for each fitting code, by month; a code with no price falls
 * back to what the bill charged, which is the best figure there is for it.
 */
function incentiveInstallRatio(alias: string): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`COALESCE(
    (SELECT SUM(COALESCE(
       (SELECT ip.sale_price1
          FROM ic_inventory_price ip
         WHERE ip.ic_code = incentive_fit.item_code
           AND ip.currency_code = '01'
           AND COALESCE(ip.status, 1) = 1
           AND ip.from_date <= ${saleReportDate(alias)}
           AND ip.to_date >= ${saleReportDate(alias)}
         ORDER BY (ip.cust_group_1 = '101') DESC, ip.from_date DESC, ip.roworder DESC
         LIMIT 1) * incentive_fit.qty,
       incentive_fit.sum_amount))
       FROM odg_sale_detail incentive_fit
      WHERE incentive_fit.doc_no = ${t}.doc_no
        AND incentive_fit.branch_code IS NOT DISTINCT FROM ${t}.branch_code
        AND incentive_fit.item_code LIKE '9701%')
    / NULLIF((SELECT SUM(incentive_air.sum_amount)
                FROM odg_sale_detail incentive_air
                JOIN app_incentive_category incentive_air_cat
                  ON incentive_air_cat.category_code = incentive_air.item_category
               WHERE incentive_air.doc_no = ${t}.doc_no
                 AND incentive_air.branch_code IS NOT DISTINCT FROM ${t}.branch_code
                 AND incentive_air_cat.pointmap_category = 'Air'), 0),
    0)`;
}

/**
 * The value a sale is banded on.
 *
 * For an air conditioner:
 *
 *   (ຍອດຂາຍ [C] + ຍອດຂາຍ [H] − ຄ່າຕິດຕັ້ງ) ÷ ຈຳນວນຊຸດ
 *
 * Read off what the customer actually PAID, not the list price. A set sold at a
 * discount is worth what it fetched, and the band is a claim about the
 * machine's value — banding a discounted set on its ticket price pays the
 * seller for money the shop never took.
 *
 * ERP stores the set as an indoor [C] and an outdoor [H] line. Summing every
 * air line on the bill would merge two different sets into one average, so the
 * opposite component is found instead: exactly one set per component line,
 * however many sets the bill carries. Dividing by qty brings a line covering
 * several sets back to one. Standalone/portable units and unpaired components
 * stand as their own set. Both halves resolve to the SAME number, which is what
 * lets a screen show one value for the set instead of two that disagree.
 *
 * ຄ່າຕິດຕັ້ງ then comes off: a bill that had the machine fitted must not be
 * pushed into a higher band than the same machine carried away. Air
 * conditioners only — nothing else in the scheme is banded on a figure a
 * fitting charge rides along with, and everything else keeps its list price.
 */
export function incentiveBandPrice(alias: string, pointmapCategory: Prisma.Sql): Prisma.Sql {
  const t = Prisma.raw(alias);
  return Prisma.sql`CASE
    WHEN ${pointmapCategory} = 'Air'
      THEN ((${t}.sum_amount + COALESCE(${incentiveMatePrice(alias)}, 0)) / NULLIF(${t}.qty, 0))
           * (1 - ${incentiveInstallRatio(alias)})
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
