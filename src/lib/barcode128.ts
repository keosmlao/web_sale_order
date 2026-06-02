// Minimal, dependency-free Code 128B encoder.
//
// Returns the geometry of the black bars (in module units) so a React
// component can render the barcode as plain inline <svg><rect/></svg> — no
// canvas, no runtime dependency. Code 128B covers ASCII 32..126, which is
// enough for the alphanumeric + hyphen item codes used on price tags
// (e.g. "110205-0392").
//
// Encoding: START_B, data values (ascii-32), checksum, STOP. Each symbol is
// a 6-module bar/space pattern (the STOP symbol is 7 modules); patterns
// alternate bar, space, bar, … starting with a bar.

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
] as const;

const START_B = 104;
const STOP = 106;

export type Code128Bars = {
  /** Black bars, positioned and sized in module units. */
  bars: { x: number; w: number }[];
  /** Total width in module units (use to set the SVG viewBox). */
  width: number;
};

/**
 * Encode `input` as Code 128B and return the black-bar geometry in module
 * units. Returns null if the string contains a character outside ASCII
 * 32..126 (so the caller can fall back to plain text).
 */
export function encodeCode128B(input: string): Code128Bars | null {
  if (!input) return null;

  const values: number[] = [];
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) return null;
    values.push(code - 32);
  }

  let checksum = START_B;
  values.forEach((v, i) => {
    checksum += v * (i + 1);
  });
  checksum %= 103;

  const sequence = [START_B, ...values, checksum, STOP];

  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const symbol of sequence) {
    const pattern = PATTERNS[symbol];
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]);
      // Even index = bar (black), odd index = space (skip, just advance).
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    }
  }

  return { bars, width: x };
}
