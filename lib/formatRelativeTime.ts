function toDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function calendarDaysAgo(target: Date, now: Date): number {
  const a = startOfLocalDay(now).getTime();
  const b = startOfLocalDay(target).getTime();
  return Math.round((a - b) / MS_PER_DAY);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWeekdayLong(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

function formatWeekdayShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function formatMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatMonthDayYear(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMessageTimestamp(value: Date | string): string {
  const d = toDate(value);
  if (!d) return "";
  const now = new Date();
  const days = calendarDaysAgo(d, now);

  if (days === 0) return formatTime(d);
  if (days === 1) return `Yesterday ${formatTime(d)}`;
  if (days > 1 && days < 7) return `${formatWeekdayLong(d)} ${formatTime(d)}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${formatMonthDay(d)}, ${formatTime(d)}`;
  }
  return formatMonthDayYear(d);
}

export function formatInboxTimestamp(value: Date | string): string {
  const d = toDate(value);
  if (!d) return "";
  const now = new Date();
  const days = calendarDaysAgo(d, now);

  if (days === 0) return formatTime(d);
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return formatWeekdayShort(d);
  if (d.getFullYear() === now.getFullYear()) return formatMonthDay(d);
  return formatMonthDayYear(d);
}
