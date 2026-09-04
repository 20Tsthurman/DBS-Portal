import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ShootRecord,
} from "@/lib/supabase";
import {
  addDaysToDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

export type ShootWithClientName = ShootRecord & { client_name: string };

/** Fetch upcoming shoots (scheduled_at >= now, status requested/confirmed) with client name attached, ascending. */
export async function fetchUpcomingShoots(
  limit?: number
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("shoots")
    .select("*")
    .in("status", ["requested", "confirmed"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return attachClientNames(supabase, (data ?? []) as ShootRecord[]);
}

/** Fetch past shoots (scheduled_at < now or status completed/cancelled/declined) with client name attached, descending. */
export async function fetchPastShoots(
  limit?: number
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("shoots")
    .select("*")
    .or(`scheduled_at.lt.${nowIso},status.in.(completed,cancelled,declined)`)
    .order("scheduled_at", { ascending: false });

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return attachClientNames(supabase, (data ?? []) as ShootRecord[]);
}

/** Fetch all shoots within [start, end) (timestamp range) with client name attached, ordered by scheduled_at ascending. */
export async function fetchShootsInRange(
  start: Date,
  end: Date
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);
  return attachClientNames(supabase, (data ?? []) as ShootRecord[]);
}

/**
 * Shoots whose wall-clock day in PORTAL_TIMEZONE equals the Central day that
 * contains `referenceDate` (default: now). Filters to active statuses
 * (`requested`, `confirmed`) and orders by `scheduled_at` ascending. Client
 * names attached via `attachClientNames`.
 *
 * We can't filter `scheduled_at` directly to a Central day because UTC and
 * Central disagree by 5-6 hours and DST shifts make it non-constant. Same
 * trick as `fetchEventsInRange` in the calendar: widen the SQL range by one
 * day on each side, then narrow precisely in JS by comparing
 * `dateKeyInTimezone(scheduled_at)` to the target day key.
 */
export async function fetchShootsForDay(
  referenceDate: Date = new Date()
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();
  const targetKey = dateKeyInTimezone(referenceDate);

  // Wide UTC bounds covering the Central day plus a 24h cushion on each side.
  const [yStr, mStr, dStr] = targetKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const dayMs = 24 * 60 * 60 * 1000;
  const dayUtc = Date.UTC(y, m - 1, d);
  const widenedStart = new Date(dayUtc - dayMs);
  const widenedEnd = new Date(dayUtc + 2 * dayMs);

  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .in("status", ["requested", "confirmed"])
    .gte("scheduled_at", widenedStart.toISOString())
    .lt("scheduled_at", widenedEnd.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ShootRecord[];
  const todays = rows.filter(
    (s) => dateKeyInTimezone(new Date(s.scheduled_at)) === targetKey
  );
  return attachClientNames(supabase, todays);
}

/**
 * Shoots scheduled in the next 7 days excluding today (Central time). Status
 * filter and ordering match `fetchShootsForDay`. Used by the dashboard's
 * "Upcoming This Week" widget — today is handled separately by Widget 1.
 *
 * Same widen-then-narrow approach: SQL pulls a UTC range that's a superset of
 * the Central window, then JS filters by the Central day key.
 */
export async function fetchShootsForWeekAhead(
  referenceDate: Date = new Date()
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();
  const todayKey = dateKeyInTimezone(referenceDate);
  const startKey = addDaysToDateKey(todayKey, 1); // tomorrow
  const endKey = addDaysToDateKey(todayKey, 7); // inclusive end of window

  // Wide UTC bounds: a calendar day in Central can straddle two UTC days, so
  // pad each side by 24h and let the JS pass do the precise day-key filter.
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const dayMs = 24 * 60 * 60 * 1000;
  const widenedStart = new Date(Date.UTC(sy, sm - 1, sd) - dayMs);
  const widenedEnd = new Date(Date.UTC(ey, em - 1, ed) + 2 * dayMs);

  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .in("status", ["requested", "confirmed"])
    .gte("scheduled_at", widenedStart.toISOString())
    .lt("scheduled_at", widenedEnd.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ShootRecord[];
  const filtered = rows.filter((s) => {
    const k = dateKeyInTimezone(new Date(s.scheduled_at));
    return k >= startKey && k <= endKey;
  });
  return attachClientNames(supabase, filtered);
}

async function attachClientNames(
  supabase: SupabaseClient,
  shoots: ShootRecord[]
): Promise<ShootWithClientName[]> {
  if (shoots.length === 0) return [];

  const clientIds = Array.from(new Set(shoots.map((s) => s.client_id)));
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (error) throw new Error(error.message);

  const nameById = new Map<string, string>();
  for (const row of (data ?? []) as Pick<ClientRecord, "id" | "name">[]) {
    nameById.set(row.id, row.name);
  }

  return shoots.map((s) => ({
    ...s,
    client_name: nameById.get(s.client_id) ?? "",
  }));
}
