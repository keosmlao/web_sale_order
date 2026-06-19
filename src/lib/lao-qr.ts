// Lao QR / BCEL One dynamic-amount QR generation.
//
// Lao QR follows the EMVCo Merchant-Presented QR spec (same family as Thai
// PromptPay). A merchant has a STATIC base payload (the fixed QR BCEL issues).
// To charge a specific amount we:
//   1. set the Point-of-Initiation Method (tag 01) to "12" (dynamic),
//   2. set the Transaction Amount (tag 54) to the amount,
//   3. drop the old CRC (tag 63) and recompute it over the rest.
//
// The amount currency is whatever the base payload already declares (tag 53);
// for a BCEL LAK merchant that's 418 (LAK), so we pass the KIP amount as-is.

// EMVCo data objects are ID(2) + LEN(2, zero-padded) + VALUE(LEN chars).
export type EmvField = { id: string; value: string };

export function parseEmv(payload: string): EmvField[] {
  const out: EmvField[] = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length < len) break; // truncated / malformed
    out.push({ id, value });
    i += 4 + len;
  }
  return out;
}

function encodeField(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  if (value.length > 99) {
    throw new Error(`EMV field ${id} too long (${value.length})`);
  }
  return `${id}${len}${value}`;
}

export function serializeEmv(fields: EmvField[]): string {
  return fields.map((f) => encodeField(f.id, f.value)).join("");
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection) — the checksum
// EMVCo mandates for tag 63. Check value: crc16("123456789") === 0x29B1.
export function crc16ccitt(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function setField(fields: EmvField[], id: string, value: string): EmvField[] {
  const next = fields.filter((f) => f.id !== id);
  next.push({ id, value });
  // EMVCo readers don't require ascending IDs, but BCEL's reference QRs are
  // sorted, so we sort to stay byte-compatible with their static QR (minus the
  // tags we changed). Tag 63 (CRC) is appended separately, always last.
  next.sort((a, b) => a.id.localeCompare(b.id));
  return next;
}

// Format an amount the way EMVCo expects: plain decimal, no thousands sep, no
// trailing zeros beyond what's needed. LAK is an integer currency so this is
// usually just the rounded integer.
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`invalid QR amount: ${amount}`);
  }
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

// Build a dynamic, amount-bearing payload from a static BCEL One QR string.
export function buildDynamicQr(basePayload: string, amount: number): string {
  const base = basePayload.trim();
  if (!base) throw new Error("missing base BCEL QR payload");
  let fields = parseEmv(base);
  if (fields.length === 0) throw new Error("unparseable base BCEL QR payload");

  fields = setField(fields, "01", "12"); // dynamic
  fields = setField(fields, "54", formatAmount(amount));
  fields = fields.filter((f) => f.id !== "63"); // drop stale CRC

  const withCrcTag = serializeEmv(fields) + "6304";
  const crc = crc16ccitt(withCrcTag)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return withCrcTag + crc;
}
