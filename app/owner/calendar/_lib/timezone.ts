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
