import { Prisma } from "@/generated/prisma/client";

/**
 * The one definition of a "ຍອດຂາຍ" line, shared by every front-store figure:
 * home cards, target card, leaderboard, special rewards and the incentive
 * report. Khua Luang branch (01), walk-in AR group (101 ຂາຍໜ້າຮ້ານ, matching
 * the bonus workbook — wholesale/project is excluded), product lines only.
 *
 * Service / fee pseudo-items (item_code 97xxxx — 9701 ຕິດຕັ້ງ, 9702 ກວດເຊັກ,
 * 9703 ຂົນສົ່ງ, 9704 ຮັບຝາກ) are money taken for a service, not a product sale,
 * so they stay out of sales, qty, achievement, ranking and bonus. They used to
 * be excluded by the incentive report only, which made the same person's
 * ຍອດຂາຍ differ between the home/target cards and the bonus report.
 *
 * @param alias table alias used in the query (e.g. "sd"); omit when the table
 *              is queried unaliased.
 */
export function saleBasis(alias = ""): Prisma.Sql {
  const p = alias ? `${alias}.` : "";
  return Prisma.raw(
    `${p}branch_code = '01' AND ${p}argroup_main = '101' AND ${p}item_code NOT LIKE '97%'`
  );
}
