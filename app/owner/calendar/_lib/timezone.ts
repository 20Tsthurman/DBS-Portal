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

import { PORTAL_TIMEZONE, dateKeyInTimezone } from "@/lib/date";

// `PORTAL_TIMEZONE` and `dateKeyInTimezone` are defined in the neutral,
// bundle-safe `@/lib/date` so client code can use them without importing from
// `app/owner/**`. PORTAL_TIMEZONE is re-exported here for existing consumers
// that import it from this module; `dateKeyInTimezone` callers import it
// directly from `@/lib/date`.
export { PORTAL_TIMEZONE };

/**
 * First and last day of the current month — interpreted in PORTAL_TIMEZONE,
 * not in UTC or server-local time. Returns YYYY-MM-DD strings suitable for
 * Supabase `date` column filters (`time_logs.date`, etc.).
 *
 * Around a UTC month boundary, the Central month and the UTC month disagree
 * for several hours; this helper keeps "this month" aligned with the rest of
 * the portal's calendar surface.
 *
 * Implementation: same trick as `dateKeyInTimezone` — read the wall-clock
 * year/month via `Intl.DateTimeFormat` keyed on PORTAL_TIMEZONE, then build
 * the date strings purely from those integers (no Date-field arithmetic on
 * server-local time).
 */
export function currentMonthRange(
  now: Date = new Date()
): { start: string; end: string } {
  const dateKey = dateKeyInTimezone(now);
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  // Day 0 of (month+1) === last day of month, calendrically. The Date here
  // is only used to extract the last day-of-month integer — no wall-clock
  // semantics — so UTC math is safe.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  const start = `${year}-${mm}-01`;
  const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
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
 * Compact wall-clock time, "9am" or "2:30pm" — lowercase, no leading zero,
 * minutes omitted on the hour. Used for the month-view event pills where
 * horizontal space is tight.
 */
export function formatShortTimeInTimezone(
  d: Date,
  tz: string = PORTAL_TIMEZONE
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const h24 = Number(map.hour);
  const mi = Number(map.minute);
  const ampm = h24 >= 12 ? "pm" : "am";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return mi === 0 ? `${h12}${ampm}` : `${h12}:${String(mi).padStart(2, "0")}${ampm}`;
}

const MONTH_LONG_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Parse "YYYY-MM" → { year, month } where month is 1-indexed. */
export function parseMonthKey(s: string): { year: number; month: number } {
  const [y, m] = s.split("-").map(Number);
  return { year: y, month: m };
}

/** Format { year, month: 1-12 } → "YYYY-MM". */
export function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Current "YYYY-MM" in `tz`. */
export function currentMonthKey(tz: string = PORTAL_TIMEZONE): string {
  const key = dateKeyInTimezone(new Date(), tz);
  return key.slice(0, 7);
}

/** Add `delta` months, normalizing year rollover. */
export function addMonthsToMonthKey(monthKey: string, delta: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const total = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = ((total % 12) + 12) % 12 + 1;
  return formatMonthKey(newYear, newMonth);
}

/**
 * YYYY-MM month key → inclusive {start, end} pair of YYYY-MM-DD date keys.
 * Use this when the range is driven by URL state rather than `now` (e.g. a
 * month picker on /owner/financials). For "this month" prefer
 * `currentMonthRange(now)` which already exists.
 */
export function monthRangeForKey(monthKey: string): { start: string; end: string } {
  const { year, month } = parseMonthKey(monthKey);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Year-to-date range: Jan 1 of the current PORTAL_TIMEZONE year through TODAY
 * (not Dec 31). `end` is today's wall-clock date in Central, so a Jan 1 query
 * at 11pm CT on Dec 31 still returns the previous year's window.
 */
export function yearToDateRange(
  now: Date = new Date()
): { start: string; end: string; year: string } {
  const today = dateKeyInTimezone(now);
  const year = today.slice(0, 4);
  return { start: `${year}-01-01`, end: today, year };
}

/**
 * The 42 date-keys (YYYY-MM-DD) for a 6×7 month grid starting on the Sunday
 * that begins the week containing the 1st of the given month. Pure string
 * math — no server-local Date methods.
 */
export function monthGridDateKeys(monthKey: string): string[] {
  const { year, month } = parseMonthKey(monthKey);
  const firstKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const firstWeekday = weekdayForDateKey(firstKey);
  const gridStartKey = addDaysToDateKey(firstKey, -firstWeekday);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(addDaysToDateKey(gridStartKey, i));
  }
  return out;
}

/** "May 2026" for a "YYYY-MM" key. */
export function formatMonthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  return `${MONTH_LONG_NAMES[month - 1]} ${year}`;
}

/** Whether a YYYY-MM-DD date-key falls inside the given YYYY-MM. */
export function dateKeyInMonth(dateKey: string, monthKey: string): boolean {
  return dateKey.slice(0, 7) === monthKey;
}

const WEEKDAY_SHORT_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

const WEEKDAY_LONG_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_SHORT_NAMES = [
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

/** "Thu", "Fri", etc. — short weekday for a YYYY-MM-DD key. */
export function shortWeekdayForDateKey(dateKey: string): string {
  return WEEKDAY_SHORT_NAMES[weekdayForDateKey(dateKey)] ?? "";
}

/** "May 14", "Dec 30" — short date label (no year). */
export function shortDateLabelForDateKey(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${MONTH_SHORT_NAMES[m - 1]} ${d}`;
}

/** "Thursday, May 14, 2026" — full date label. */
export function fullDateLabelForDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = WEEKDAY_LONG_NAMES[weekdayForDateKey(dateKey)] ?? "";
  return `${weekday}, ${MONTH_LONG_NAMES[m - 1]} ${d}, ${y}`;
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
