import { Prisma } from "@/generated/prisma/client";

// Stock promised on sales orders that have not been settled yet.
//
// A SOK is a promise, not a movement: the shelf is only decremented when
// the cashier settles it into a CAKAP receipt. So the raw balance says a
// fridge is there right up to the moment someone walks out with the one
// that was already sold this morning — item 110101-0009 in warehouse 1101
// stood at one on the shelf against four promised on open orders.
//
// Every stock figure the counter is shown must therefore be
//   on hand − promised
// so two people cannot sell the same unit.
//
// `excludeDocNo` is for editing: an order being rewritten must not be
// counted against itself, or its own lines would make its own quantities
// unreachable. Editing is by replacement — the old order still exists
// while the new one is built — so this is not optional.
export function committedStockCte(excludeDocNo?: string | null) {
  const exclude = (excludeDocNo ?? "").trim();
  return Prisma.sql`
    SELECT
      d.item_code,
      d.wh_code,
      d.shelf_code,
      SUM(COALESCE(d.qty, 0)) AS qty,
      -- Who is holding it, so the shelf figure can say more than "gone".
      -- The line's own salesperson wins over the bill's: a cart can
      -- credit several sellers.
      STRING_AGG(
        DISTINCT COALESCE(
          NULLIF(TRIM(e.fullname_lo), ''),
          NULLIF(TRIM(e.fullname_en), ''),
          NULLIF(TRIM(d.sale_code), ''),
          NULLIF(TRIM(t.sale_code), '')
        ),
        ', '
      ) AS held_by
    FROM ic_trans t
    JOIN ic_trans_detail d ON d.doc_no = t.doc_no
    LEFT JOIN odg_employee e
      ON e.employee_code = COALESCE(
           NULLIF(TRIM(d.sale_code), ''),
           NULLIF(TRIM(t.sale_code), '')
         )
    WHERE t.doc_format_code = 'SOK'
      -- 0 = waiting to be paid. 1 is settled (the shelf already moved)
      -- and 2 is cancelled, so neither holds anything.
      AND COALESCE(t.status, 0) = 0
      AND (${exclude} = '' OR t.doc_no <> ${exclude})
    GROUP BY d.item_code, d.wh_code, d.shelf_code
  `;
}
