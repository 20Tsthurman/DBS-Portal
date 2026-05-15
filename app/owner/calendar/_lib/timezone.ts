/**
 * Portal timezone module.
 *
 * Every wall-clock time stored in `time_blocks` (the `date`, `start_time`,
 * `end_time` columns) is interpreted in this zone, regardless of where the
 * Next.js server happens to run. Without this, `new Date("2026-05-15T09:00")`
 * would resolve to 9 AM UTC on a Vercel build node and 9 AM Central locally
 * — silent drift we don't want.
 *
 * Shoots store full UTC timestamps in `shoots.scheduled_at` and do NOT need
 * timezone assembly. They land on `CalendarEvent.startsAt` directly.
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
 * days for a calendar grid. `dateMath.dateKey()` uses server-local time and
 * will drift on a UTC server — prefer this helper everywhere a day key
 * crosses the DB boundary.
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

interface WallClockParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  se: number;
}

function readWallClock(d: Date, tz: string): WallClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    h: Number(map.hour),
    mi: Number(map.minute),
    se: Number(map.second),
  };
}

/**
 * String math on YYYY-MM-DD date keys. Timezone-agnostic — we use UTC
 * arithmetic only because calendar dates are calendrically consistent
 * across zones (a day is a day). Never compute a wall-clock date by
 * reading server-local Date fields.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD wall-clock date. */
export function weekdayForDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Sunday-of-the-week date key for the week containing the wall-clock date
 * of `d` in `tz`. Returns YYYY-MM-DD.
 */
export function weekStartKeyForDate(
  d: Date,
  tz: string = PORTAL_TIMEZONE
): string {
  const key = dateKeyInTimezone(d, tz);
  const dow = weekdayForDateKey(key);
  return addDaysToDateKey(key, -dow);
}

/**
 * "May 11 – 17, 2026"            (same month)
 * "Apr 28 – May 4, 2026"         (cross month, same year)
 * "Dec 30, 2025 – Jan 5, 2026"   (cross year)
 */
export function formatWeekRangeLabel(weekStartKey: string): string {
  const endKey = addDaysToDateKey(weekStartKey, 6);
  const [sy, sm, sd] = weekStartKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const startMonth = monthShort(sm);
  const endMonth = monthShort(em);
  if (sy !== ey) {
    return `${startMonth} ${sd}, ${sy} – ${endMonth} ${ed}, ${ey}`;
  }
  if (sm !== em) {
    return `${startMonth} ${sd} – ${endMonth} ${ed}, ${sy}`;
  }
  return `${startMonth} ${sd} – ${ed}, ${sy}`;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthShort(monthOneBased: number): string {
  return MONTH_SHORT[monthOneBased - 1] ?? "";
}

/**
 * Hour-of-day as a decimal fraction in `tz` (e.g., 14.5 for 2:30 PM).
 *
 * Use this for positioning a UTC `Date` on a wall-clock time grid (like the
 * week view's vertical axis). The plain `d.getHours()` would return the
 * server's local hour, which silently drifts on a UTC host — banned by the
 * timezone convention documented in `./types.ts`.
 */
export function hourOfDayInTimezone(
  d: Date,
  tz: string = PORTAL_TIMEZONE
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const h = Number(map.hour);
  const m = Number(map.minute);
  const s = Number(map.second);
  return h + m / 60 + s / 3600;
}

/**
 * Format a UTC `Date` as a wall-clock time string in `tz`, like "9:00 AM".
 */
export function formatTimeInTimezone(
  d: Date,
  tz: string = PORTAL_TIMEZONE
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/**
 * Build a UTC `Date` representing the instant when `tz`'s wall clock reads
 * `dateStr` + `timeStr`. DST-aware.
 *
 *   combineDateAndTimeInTimezone("2026-05-15", "09:00") === 14:00Z (CDT)
 *   combineDateAndTimeInTimezone("2026-01-15", "09:00") === 15:00Z (CST)
 */
export function combineDateAndTimeInTimezone(
  dateStr: string,
  timeStr: string,
  tz: string = PORTAL_TIMEZONE
): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const timeParts = timeStr.split(":");
  const h = Number(timeParts[0]);
  const mi = Number(timeParts[1]);
  const se = timeParts[2] !== undefined ? Number(timeParts[2]) : 0;

  // Pretend the wall clock IS UTC. The Date we get is wrong by exactly the
  // zone's offset at this moment — we read it back through `tz` and correct.
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, se);
  const seen = readWallClock(new Date(asUtc), tz);
  const seenUtc = Date.UTC(
    seen.y,
    seen.mo - 1,
    seen.d,
    seen.h,
    seen.mi,
    seen.se
  );
  return new Date(asUtc + (asUtc - seenUtc));
}
