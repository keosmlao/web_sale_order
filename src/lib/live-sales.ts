import { Prisma } from "@/generated/prisma/client";

// Whole-company sales read straight from the ERP, bypassing odg_sale_detail.
//
// odg_sale_detail is an ETL copy on a refresh cycle: it trails the ERP by about
// a day, and closed months keep drifting as documents are amended behind it
// (March 2026 was 2,631 light, August 72,770 light when this was measured).
// Reading ic_trans directly removes both.
//
// The three rules below are what reproduce odg_sale_detail exactly — six of the
// eight months of 2026 came back to the cent, and the two that did not were the
// months the copy had not caught up on:
//
//   trans_flag 44  ຂາຍ      — CAK, INK, INH*, CAH*, COD*, CAP*, CAS*, INS*,
//                             INP*, POS. Counted positive.
//   trans_flag 48  ໃບຫຼຸດ    — CNH*, CNK*, CNP*, CNS*. The ERP stores these
//                             positive; the sales figure needs them negative.
//   item_type 3               A SET header (a split air conditioner, mostly).
//                             The ERP writes the set's full value on the header
//                             line AND again across its component lines, which
//                             carry item_code_main pointing back at it — so
//                             summing every line double-counts every set. This
//                             is the whole reason a naive ic_trans_detail sum
//                             reads ~2% high: July 2026 came to 83,275,571
//                             against the true 81,620,492.
//
// Cancelled documents (cancel_type <> 0) are excluded; odg_sale_detail has no
// cancel column at all, so this is the one thing the live read can check that
// the copy cannot.

export const SALE_TRANS_FLAG = 44;
export const RETURN_TRANS_FLAG = 48;

/**
 * FROM + WHERE for every live company sale line. Callers append their own
 * date range with `AND t.doc_date >= ...`. Aliases are fixed: `t` for the
 * document header, `d` for the line.
 */
export const LIVE_SALES_SOURCE = Prisma.sql`
  FROM ic_trans t
  JOIN ic_trans_detail d ON d.doc_no = t.doc_no
  WHERE t.trans_flag IN (${SALE_TRANS_FLAG}, ${RETURN_TRANS_FLAG})
    AND COALESCE(t.cancel_type, 0) = 0
    AND d.item_type <> 3
`;

/** Line amount with credit notes flipped negative. */
export const LIVE_SALE_AMOUNT = Prisma.sql`
  (d.sum_amount * CASE WHEN t.trans_flag = ${RETURN_TRANS_FLAG} THEN -1 ELSE 1 END)
`;
