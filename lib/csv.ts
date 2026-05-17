/**
 * RFC 4180 CSV cell escaping. Shared by all CSV export server actions.
 *
 * Wraps any field containing comma, double-quote, CR, or LF in double quotes,
 * and escapes internal `"` as `""`. Null/undefined coerces to empty string;
 * numbers are stringified (caller decides numeric formatting).
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "number" ? String(value) : value;
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
