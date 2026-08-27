/**
 * A split air conditioner, read as the one product it is.
 *
 * The ERP records a set as two lines — an indoor "… [C]" and an outdoor
 * "… [H]" — each carrying half the money, and the scoring query scores the set
 * on the indoor line so the outdoor one comes back with zero points. Every
 * screen that lists lines therefore showed each machine twice: once with its
 * points, once as a bare zero beside the same band, and one sale's takings read
 * as two half-sales.
 *
 * Folding is what makes a row a SET. The outdoor half's money goes to its
 * indoor partner and the half itself is dropped, so quantity stays a count of
 * machines and the amount is what the whole set brought in. Points are
 * untouched: the halves score zero, so nothing can be gained or lost here.
 *
 * Halves are paired inside their own bill and against the nearest indoor item
 * code — a set's two components are catalogued next to each other — which is
 * the same pairing the scoring query uses, so a screen can never disagree with
 * the points it is showing. An outdoor unit sold on its own has no partner to
 * fold into: it is a machine in its own right, scores in its own right, and
 * stays as its own row.
 *
 * Kept in step with the management app (odgmgt-next lib/incentive-sets.js).
 */

type FoldableLine = {
  doc_no?: string | null;
  item_code?: string | null;
  item_name?: string | null;
  point_qty?: string | number | null;
};

/** Digits of an item code, for measuring how far apart two codes sit. */
const codeNumber = (code: string | null | undefined) =>
  Number(String(code ?? "").replace(/\D/g, "")) || 0;

const isIndoor = (row: FoldableLine) => /\[C\]\s*$/.test(String(row.item_name ?? ""));

/**
 * Whether this row is an outdoor half whose points were taken by its partner.
 *
 * `point_qty` is the scoring query's own answer to "did something else score
 * this set" — reading the name alone would also catch the lone outdoor unit
 * that legitimately scores itself.
 */
const isFoldableHalf = (row: FoldableLine) =>
  Number(row.point_qty ?? 0) === 0 && /\[H\]\s*$/.test(String(row.item_name ?? ""));

/**
 * One row per set: outdoor halves folded into their indoor partners.
 *
 * @param rows      scored lines carrying doc_no, item_code, item_name and point_qty.
 * @param addAmount moves the half's money onto the surviving partner. Callers
 *                  that carry no money on a line leave it out.
 */
export function foldAirSets<T extends FoldableLine>(
  rows: T[],
  addAmount?: (partner: T, half: T) => void,
): T[] {
  const byBill = new Map<string, T[]>();
  for (const row of rows) {
    const doc = String(row.doc_no ?? "");
    const bill = byBill.get(doc);
    if (bill) bill.push(row);
    else byBill.set(doc, [row]);
  }

  const folded = new Set<T>();
  for (const billRows of byBill.values()) {
    const indoors = billRows.filter(isIndoor);
    if (!indoors.length) continue;
    for (const half of billRows) {
      if (!isFoldableHalf(half)) continue;
      let partner: T | null = null;
      let nearest = Infinity;
      for (const indoor of indoors) {
        const gap = Math.abs(codeNumber(indoor.item_code) - codeNumber(half.item_code));
        if (gap < nearest) { nearest = gap; partner = indoor; }
      }
      if (!partner) continue;
      addAmount?.(partner, half);
      folded.add(half);
    }
  }

  return folded.size ? rows.filter((row) => !folded.has(row)) : rows;
}
