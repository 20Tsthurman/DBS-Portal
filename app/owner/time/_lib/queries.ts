import {
  getSupabaseServiceClient,
  type ClientRecord,
  type TimeLogCategory,
  type TimeLogRecord,
} from "@/lib/supabase";
import {
  addDaysToDateKey,
  currentMonthRange,
  dateKeyInTimezone,
  formatMonthKey,
  formatMonthLabel,
  weekdayForDateKey,
} from "@/app/owner/calendar/_lib/timezone";

export interface ClientHours {
  clientId: string;
  clientName: string;
  hours: number;
}

export interface CategoryHours {
  category: TimeLogCategory;
  hours: number;
}

export interface WeeklyBreakdown {
  rangeLabel: string;
  weekStartKey: string;
  weekEndKey: string;
  totalHours: number;
  byClient: ClientHours[];
  byCategory: CategoryHours[];
}

export interface MonthlyBreakdown {
  monthLabel: string;
  monthKey: string;
  totalHours: number;
  byClient: ClientHours[];
}

/**
 * Monday-start week containing `now` (Central time). Returns YYYY-MM-DD keys
 * for the Monday (inclusive) and Sunday (inclusive). Use these directly with
 * the `time_logs.date` column — that column is a SQL `date`, not a
 * `timestamptz`, so timezone math on the column itself is unnecessary; we
 * only need to compute the bounding dates in Central time.
 *
 * `weekdayForDateKey` returns 0=Sun..6=Sat, so for Monday-start the offset
 * to subtract is `(dow + 6) % 7` (Mon→0, Tue→1, ..., Sun→6).
 */
function currentWeekRangeMondayStart(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const todayKey = dateKeyInTimezone(now);
  const dow = weekdayForDateKey(todayKey);
  const mondayOffset = (dow + 6) % 7;
  const start = addDaysToDateKey(todayKey, -mondayOffset);
  const end = addDaysToDateKey(start, 6);
  return { start, end };
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

/**
 * "Week of May 11–17", "Week of Apr 28 – May 4", "Week of Dec 30 – Jan 5".
 * Includes the year only when the week spans a year boundary.
 */
function formatWeekOfLabel(startKey: string, endKey: string): string {
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const sMonth = MONTH_SHORT[sm - 1];
  const eMonth = MONTH_SHORT[em - 1];
  if (sy !== ey) {
    return `Week of ${sMonth} ${sd}, ${sy} – ${eMonth} ${ed}, ${ey}`;
  }
  if (sm !== em) {
    return `Week of ${sMonth} ${sd} – ${eMonth} ${ed}`;
  }
  return `Week of ${sMonth} ${sd}–${ed}`;
}

interface TimeLogWithClient
  extends Pick<
    TimeLogRecord,
    "id" | "client_id" | "date" | "hours" | "category" | "notes" | "logged_by" | "created_at"
  > {
  clientName: string;
}

/**
 * All time_logs whose `date` is within [start, end] (inclusive on both
 * ends), with `clientName` resolved via a second fetch against `clients`.
 * Mirrors the pattern used elsewhere (`attachClientNames` in
 * `app/owner/shoots/_lib/queries.ts`) rather than relying on PostgREST
 * embeds — keeps the type story simple and the service-client behaviour
 * predictable.
 */
async function fetchTimeLogsInRange(
  startKey: string,
  endKey: string
): Promise<TimeLogWithClient[]> {
  const supabase = getSupabaseServiceClient();

  const { data: logsRaw, error: logsError } = await supabase
    .from("time_logs")
    .select(
      "id, client_id, date, hours, category, notes, logged_by, created_at"
    )
    .gte("date", startKey)
    .lte("date", endKey)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  if (logsError) throw new Error(logsError.message);

  const logs = (logsRaw ?? []) as Array<
    Pick<
      TimeLogRecord,
      | "id"
      | "client_id"
      | "date"
      | "hours"
      | "category"
      | "notes"
      | "logged_by"
      | "created_at"
    >
  >;
  if (logs.length === 0) return [];

  const clientIds = Array.from(new Set(logs.map((l) => l.client_id)));
  const { data: clientRows, error: clientError } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (clientError) throw new Error(clientError.message);

  const nameById = new Map<string, string>();
  for (const row of (clientRows ?? []) as Pick<ClientRecord, "id" | "name">[]) {
    nameById.set(row.id, row.name);
  }

  return logs.map((l) => ({
    ...l,
    clientName: nameById.get(l.client_id) ?? "Unknown client",
  }));
}

/**
 * Sum-by-client and sum-by-category for the Monday-start week containing
 * `now` (Central time). Both arrays are sorted by hours descending.
 */
export async function fetchWeeklyTimeBreakdown(
  now: Date = new Date()
): Promise<WeeklyBreakdown> {
  const { start, end } = currentWeekRangeMondayStart(now);
  const logs = await fetchTimeLogsInRange(start, end);

  const byClientMap = new Map<string, ClientHours>();
  const byCategoryMap = new Map<TimeLogCategory, number>();
  let totalHours = 0;

  for (const log of logs) {
    const h = Number(log.hours);
    totalHours += h;
    const existing = byClientMap.get(log.client_id);
    if (existing) {
      existing.hours += h;
    } else {
      byClientMap.set(log.client_id, {
        clientId: log.client_id,
        clientName: log.clientName,
        hours: h,
      });
    }
    byCategoryMap.set(log.category, (byCategoryMap.get(log.category) ?? 0) + h);
  }

  const byClient = Array.from(byClientMap.values()).sort(
    (a, b) => b.hours - a.hours
  );
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, hours]) => ({ category, hours }))
    .sort((a, b) => b.hours - a.hours);

  return {
    rangeLabel: formatWeekOfLabel(start, end),
    weekStartKey: start,
    weekEndKey: end,
    totalHours,
    byClient,
    byCategory,
  };
}

/**
 * Sum-by-client for the current Central month. `byClient` is sorted by hours
 * descending. No category breakdown here — the monthly view only needs the
 * per-client chart.
 */
export async function fetchMonthlyTimeBreakdown(
  now: Date = new Date()
): Promise<MonthlyBreakdown> {
  const { start, end } = currentMonthRange(now);
  const logs = await fetchTimeLogsInRange(start, end);

  const byClientMap = new Map<string, ClientHours>();
  let totalHours = 0;

  for (const log of logs) {
    const h = Number(log.hours);
    totalHours += h;
    const existing = byClientMap.get(log.client_id);
    if (existing) {
      existing.hours += h;
    } else {
      byClientMap.set(log.client_id, {
        clientId: log.client_id,
        clientName: log.clientName,
        hours: h,
      });
    }
  }

  const byClient = Array.from(byClientMap.values()).sort(
    (a, b) => b.hours - a.hours
  );

  const monthKey = start.slice(0, 7);

  return {
    monthLabel: formatMonthLabel(monthKey),
    monthKey,
    totalHours,
    byClient,
  };
}

/**
 * Fetch all time_logs for the current Central month, sorted by date then
 * created_at ascending. Used by the CSV exporter — keeps the full row plus
 * the resolved client name so the action can format directly into CSV.
 */
export async function fetchMonthlyTimeLogsForExport(
  now: Date = new Date()
): Promise<TimeLogWithClient[]> {
  const { start, end } = currentMonthRange(now);
  return fetchTimeLogsInRange(start, end);
}

/** Current Central month key (YYYY-MM) — used for the CSV filename. */
export function currentMonthKeyForExport(now: Date = new Date()): string {
  const { start } = currentMonthRange(now);
  return start.slice(0, 7);
}

// Re-exported so callers don't need to import from two places.
export { formatMonthKey };
