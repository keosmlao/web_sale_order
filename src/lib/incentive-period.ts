// Shared helpers for the incentive settings screens (ຈັດການເປົ້າຂາຍ,
// ຈັດການລາງວັນພິເສດ). Both are driven by a month the manager picks and both
// take grouped money input, so the label / date-range maths and the
// thousand-separator handling live in one place.

export const LAO_MONTHS = [
  "ມັງກອນ",
  "ກຸມພາ",
  "ມີນາ",
  "ເມສາ",
  "ພຶດສະພາ",
  "ມິຖຸນາ",
  "ກໍລະກົດ",
  "ສິງຫາ",
  "ກັນຍາ",
  "ຕຸລາ",
  "ພະຈິກ",
  "ທັນວາ",
] as const;

export const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const pad = (value: number) => String(value).padStart(2, "0");

export const periodLabel = (year: number, month: number) =>
  `${LAO_MONTHS[month - 1]} ${year}`;

export const monthBadge = (year: number, month: number) => `${pad(month)}/${year}`;

/** First day of the period as the YYYY-MM-DD the rewards API expects. */
export const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;

/** Last day of the period — `new Date(y, m, 0)` rolls back to month m's end. */
export const monthEnd = (year: number, month: number) =>
  `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;

// Money amounts are typed as text so they can carry thousand separators —
// `type="number"` inputs reject a comma. Digits are grouped as the manager
// types (1234567 → 1,234,567) and read back with digitsOf() at every parse
// site. Grouping is done on the digit string rather than through Number() so a
// long paste can never lose precision on the way to the screen.
const MAX_DIGITS = 15;

export function formatAmountInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITS);
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Numeric value of a grouped input ("1,234,567" → 1234567; blank → 0). */
export const digitsOf = (raw: string): number => Number(raw.replace(/\D/g, "") || 0);
