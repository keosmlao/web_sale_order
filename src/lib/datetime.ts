// One date format for every screen a cashier reads: dd-MM-yyyy HH:mm,
// 24-hour. toLocaleString() was showing whatever the device's locale
// fancied — "8/29/2026, 5:53:01 AM" on one phone, something else on the
// next — and the format is the shop's, not the phone's.
export function fmtDateTime(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
