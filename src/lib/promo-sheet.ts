// Reading a price sheet the way the shop actually writes one.
//
// Promotions run off a spreadsheet: one row per item, a normal price, a
// special price, sometimes a free gift named in prose, and one date window
// for the whole sheet. The admin form takes one promotion at a time, which
// is why in a year of selling promotions exactly two were ever entered —
// and both were tests. A sheet of thirty rows on a three-day window is not
// something anyone will key in by hand.
//
// So the sheet is the input. Paste the columns, check what came back, and
// commit the lot.

export type SheetRow = {
  line: number;
  itemCode: string;
  // "ລາຄາປົກກະຕິ" — read but not stored: the engine prices against the
  // live catalogue price, and a stale figure typed on a sheet must never
  // override it.
  normalPrice: number | null;
  specialPrice: number | null;
  // "ໂປຣໂມຊັ້ນ" — free-text, e.g. "Free ເຄື່ອງເຮັດນ້ຳອຸ່ນ CENTON GT331E".
  giftText: string | null;
  note: string | null;
};

// The sheet's own dash for "nothing here".
function isBlank(v: string): boolean {
  const t = v.trim();
  return t === "" || t === "-" || t === "—" || t === "–";
}

function parseMoney(raw: string): number | null {
  if (isBlank(raw)) return null;
  // 6,070,000 / 6 070 000 / 6070000.00
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Item codes are 6 digits, a dash, then 4 — "110104-0580". Recognising
// them by shape is what lets a pasted row be understood whatever order
// the sheet's columns happen to be in, which varies between sheets.
const CODE = /\b(\d{6}-\d{4})\b/;

export function parseSheet(text: string): {
  rows: SheetRow[];
  skipped: number;
} {
  const rows: SheetRow[] = [];
  let skipped = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const codeMatch = CODE.exec(line);
    if (!codeMatch) {
      // Headers, the company address, the date banner — everything above
      // the table. Counted rather than reported one by one.
      skipped++;
      continue;
    }

    // Tab-separated when pasted from a spreadsheet; fall back to runs of
    // two or more spaces for text copied out of a PDF.
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/ {2,}/))
      .map((c) => c.trim())
      .filter((c) => c !== "");

    const codeIdx = cells.findIndex((c) => CODE.test(c));
    const after = codeIdx >= 0 ? cells.slice(codeIdx + 1) : cells;

    // The money columns are the numeric ones, in sheet order: normal
    // price then special price. Sizes (8, 20, 9.2) sit in their own
    // column and would read as money, so only values large enough to be
    // a kip price count.
    const money = after
      .map((c) => parseMoney(c))
      .filter((n): n is number => n !== null && n >= 10000);

    // The gift column is prose. It is the cell that names something
    // rather than measuring it.
    const gift =
      after.find((c) => /free|ແຖມ|ຟຣີ/i.test(c) && !isBlank(c)) ?? null;

    rows.push({
      line: i + 1,
      itemCode: codeMatch[1],
      normalPrice: money.length > 1 ? money[0] : null,
      specialPrice: money.length > 1 ? money[1] : (money[0] ?? null),
      giftText: gift,
      note: null,
    });
  }

  return { rows, skipped };
}

// Strip the words that decorate a gift ("Free", "ຟຣີ", "ແຖມ") so what is
// left is the product name to search for.
export function giftSearchTerm(giftText: string): string {
  return giftText
    .replace(/free/gi, " ")
    .replace(/ຟຣີ/g, " ")
    .replace(/ແຖມ/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
