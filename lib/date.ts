/**
 * Portal timezone + the core "which Central-time day is this UTC instant on"
 * helper. Lives in neutral `lib/` (not under any route group) so both the
 * owner and client surfaces can import it without reaching into
 * `app/owner/**` or dragging owner-only code into a client bundle.
 *
 * The richer calendar helpers (week/month grids, range math, label
 * formatting) still live in `app/owner/calendar/_lib/timezone.ts`, which now
 * re-exports `PORTAL_TIMEZONE` from here and builds on `dateKeyInTimezone`.
 */

export const PORTAL_TIMEZONE = "America/Chicago";

const dateKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: PORTAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Local YYYY-MM-DD for a UTC `Date` as observed in PORTAL_TIMEZONE.
 *
 * Use this when bucketing UTC timestamps (e.g. `shoots.scheduled_at`) into
 * days, or to get "today" in Central time via `dateKeyInTimezone(new Date())`.
 * Plain server-local Date methods drift on a UTC host — prefer this helper
 * everywhere a day key crosses the DB boundary.
 */
export function dateKeyInTimezone(
  d: Date,
  tz: string = PORTAL_TIMEZONE
): string {
  if (tz === PORTAL_TIMEZONE) return dateKeyFmt.format(d);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
