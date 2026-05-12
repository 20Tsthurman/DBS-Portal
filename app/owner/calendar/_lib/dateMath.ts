export interface YearMonth {
  year: number;
  month: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function currentYearMonth(now: Date = new Date()): YearMonth {
  return { year: now.getFullYear(), month: now.getMonth() };
}

/** "YYYY-MM" → {year, month}. Falls back to the current month on any parse failure. */
export function parseMonthParam(s: string | undefined): YearMonth {
  if (!s) return currentYearMonth();
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return currentYearMonth();
  const year = Number(m[1]);
  const monthNum = Number(m[2]);
  if (monthNum < 1 || monthNum > 12) return currentYearMonth();
  return { year, month: monthNum - 1 };
}

export function formatMonthParam({ year, month }: YearMonth): string {
  return `${year}-${pad(month + 1)}`;
}

export function monthLabel({ year, month }: YearMonth): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** "YYYY-MM-DD" → local Date at midnight. Returns null on parse failure. */
export function parseDateParam(s: string | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local YYYY-MM-DD for a Date. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 6×7 = 42 contiguous local Dates (midnight) starting on the Sunday that
 * begins the week containing the 1st of {year, month}.
 */
export function getMonthGrid({ year, month }: YearMonth): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const dayOfWeek = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - dayOfWeek);
  const grid: Date[] = [];
  for (let i = 0; i < 42; i++) {
    grid.push(
      new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i
      )
    );
  }
  return grid;
}

/** [start, endExclusive] covering the entire 42-day grid for a month, midnight-local. */
export function gridRange(ym: YearMonth): { start: Date; end: Date } {
  const grid = getMonthGrid(ym);
  const start = grid[0];
  const last = grid[41];
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { start, end };
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(d: Date, now: Date = new Date()): boolean {
  return isSameDay(d, now);
}

export function inMonth(d: Date, { year, month }: YearMonth): boolean {
  return d.getFullYear() === year && d.getMonth() === month;
}

export function friendlyDate(d: Date): string {
  return `${WEEKDAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatTimeOnly(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function weekdayLabel(n: number): string {
  return WEEKDAY_NAMES[n] ?? "";
}

function formatClockTime(t: string): string {
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

/** "8:00 AM – 5:00 PM" for a time range, or "All day" when both ends are null. */
export function formatTimeRange(
  start: string | null,
  end: string | null
): string {
  if (!start || !end) return "All day";
  return `${formatClockTime(start)} – ${formatClockTime(end)}`;
}

/** ISO timestamp at 9:00 AM local on the given day — the default fill for new shoots from the calendar. */
export function defaultShootIsoForDay(d: Date): string {
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    9,
    0,
    0
  ).toISOString();
}

/** Sunday (midnight local) of the week containing d. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

/** Midnight local on the Sunday following the week containing d (exclusive end). */
export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
}

/** Seven Dates (midnight local) starting on startOfWeek(d). */
export function getWeekDates(d: Date): Date[] {
  const start = startOfWeek(d);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    );
  }
  return out;
}

/** weekStart shifted by delta weeks (may be negative). Result is midnight local. */
export function addWeeks(weekStart: Date, delta: number): Date {
  return new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + delta * 7
  );
}

/**
 * "May 11 – 17, 2026" when same month, "Apr 28 – May 4, 2026" across months,
 * "Dec 30, 2025 – Jan 5, 2026" across years.
 */
export function weekLabel(weekStart: Date): string {
  const end = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate() + 6
  );
  const sM = MONTH_NAMES[weekStart.getMonth()];
  const eM = MONTH_NAMES[end.getMonth()];
  const sY = weekStart.getFullYear();
  const eY = end.getFullYear();
  if (sY !== eY) {
    return `${sM} ${weekStart.getDate()}, ${sY} – ${eM} ${end.getDate()}, ${eY}`;
  }
  if (sM !== eM) {
    return `${sM} ${weekStart.getDate()} – ${eM} ${end.getDate()}, ${sY}`;
  }
  return `${sM} ${weekStart.getDate()} – ${end.getDate()}, ${sY}`;
}

/** "YYYY-MM-DD" for the week URL param. */
export function formatWeekParam(weekStart: Date): string {
  return dateKey(weekStart);
}

/**
 * Parse "YYYY-MM-DD" → Date (normalized to its Sunday). Falls back to
 * startOfWeek(now) on parse failure. If the parsed date isn't a Sunday,
 * it's normalized so deep-linked mid-week dates still resolve cleanly.
 */
export function parseWeekParam(s: string | undefined): Date {
  if (!s) return startOfWeek(new Date());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return startOfWeek(new Date());
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return startOfWeek(new Date());
  return startOfWeek(d);
}

/** Week-view time grid constants. 6 AM → 10 PM, 50px per hour. */
export const WEEK_GRID_START_HOUR = 6;
export const WEEK_GRID_END_HOUR = 22;
export const WEEK_GRID_HOUR_PX = 50;
export const WEEK_GRID_HEIGHT_PX =
  (WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;

/** Vertical pixel offset for a clock time within the week grid (clamped). */
export function weekGridTopForDate(d: Date): number {
  const hours = d.getHours() + d.getMinutes() / 60;
  const raw = (hours - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
  return Math.max(0, Math.min(raw, WEEK_GRID_HEIGHT_PX));
}

/** Same as weekGridTopForDate but takes a "HH:MM" or "HH:MM:SS" PG time string. */
export function weekGridTopForClock(time: string): number {
  const [hStr, mStr] = time.split(":");
  const hours = Number(hStr) + Number(mStr) / 60;
  const raw = (hours - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
  return Math.max(0, Math.min(raw, WEEK_GRID_HEIGHT_PX));
}

/** Hour label e.g. "6 AM", "12 PM", "11 PM". */
export function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}
