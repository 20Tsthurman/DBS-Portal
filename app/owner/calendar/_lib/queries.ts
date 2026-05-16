import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ShootRecord,
  type ShootStatus,
  type TimeBlockCategory,
  type TimeBlockRecord,
} from "@/lib/supabase";
import { dateKey } from "./dateMath";
import {
  combineDateAndTimeInTimezone,
  dateKeyInTimezone,
} from "./timezone";
import type { CalendarEvent } from "./types";

type ShootLite = Pick<
  ShootRecord,
  "id" | "client_id" | "scheduled_at" | "duration_hours" | "location" | "status"
>;

type TimeBlockLite = Pick<
  TimeBlockRecord,
  | "id"
  | "date"
  | "start_time"
  | "end_time"
  | "category"
  | "client_id"
  | "label"
  | "notes"
>;

/**
 * Fetch every event (shoots + time_blocks) overlapping [start, end) and
 * return them as a single sorted `CalendarEvent[]`. Used by the owner
 * Week / Month / Agenda views.
 *
 * `start` and `end` are UTC `Date`s.
 *
 * The time_blocks query intersects on the local `date` column. We widen
 * the date filter by one day on each side because a wall-clock date in
 * PORTAL_TIMEZONE can sit on either side of UTC midnight (and DST shifts
 * make the offset non-constant). The exact UTC-instant filter is then
 * applied in code after assembling startsAt/endsAt.
 */
export async function fetchEventsInRange(
  start: Date,
  end: Date
): Promise<CalendarEvent[]> {
  const supabase = getSupabaseServiceClient();

  const dayMs = 24 * 60 * 60 * 1000;
  const blocksDateLo = dateKey(new Date(start.getTime() - dayMs));
  const blocksDateHi = dateKey(new Date(end.getTime() + dayMs));

  const [shootsRes, blocksRes] = await Promise.all([
    supabase
      .from("shoots")
      .select(
        "id, client_id, scheduled_at, duration_hours, location, status"
      )
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString()),
    supabase
      .from("time_blocks")
      .select(
        "id, date, start_time, end_time, category, client_id, label, notes"
      )
      .gte("date", blocksDateLo)
      .lt("date", blocksDateHi),
  ]);

  if (shootsRes.error) throw new Error(shootsRes.error.message);
  if (blocksRes.error) throw new Error(blocksRes.error.message);

  const shoots = (shootsRes.data ?? []) as ShootLite[];
  const blocks = (blocksRes.data ?? []) as TimeBlockLite[];

  const clientIds = Array.from(
    new Set<string>([
      ...shoots.map((s) => s.client_id),
      ...blocks
        .map((b) => b.client_id)
        .filter((id): id is string => id !== null),
    ])
  );
  const nameById = await fetchClientNames(supabase, clientIds);

  const events: CalendarEvent[] = [];
  for (const s of shoots) {
    events.push(shootToEvent(s, nameById));
  }
  for (const b of blocks) {
    const event = timeBlockToEvent(b, nameById);
    if (event.endsAt <= start || event.startsAt >= end) continue;
    events.push(event);
  }
  events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return events;
}

function shootToEvent(
  s: ShootLite,
  nameById: Map<string, string>
): CalendarEvent {
  const startsAt = new Date(s.scheduled_at);
  const endsAt = s.duration_hours
    ? new Date(startsAt.getTime() + Number(s.duration_hours) * 60 * 60 * 1000)
    : startsAt;
  return {
    id: `shoot:${s.id}`,
    category: "shoot",
    dateKey: dateKeyInTimezone(startsAt),
    startsAt,
    endsAt,
    title: nameById.get(s.client_id) ?? "",
    subtitle: s.location,
    status: s.status as ShootStatus,
    source: { kind: "shoot", shootId: s.id, clientId: s.client_id },
  };
}

function timeBlockToEvent(
  b: TimeBlockLite,
  nameById: Map<string, string>
): CalendarEvent {
  const startsAt = combineDateAndTimeInTimezone(b.date, b.start_time);
  const endsAt = combineDateAndTimeInTimezone(b.date, b.end_time);
  const subtitle =
    b.category === "work_block" && b.client_id
      ? (nameById.get(b.client_id) ?? null)
      : null;
  return {
    id: `time_block:${b.id}`,
    category: b.category,
    dateKey: b.date,
    startsAt,
    endsAt,
    title: b.label?.trim() || defaultLabelForCategory(b.category),
    subtitle,
    status: "scheduled",
    source: {
      kind: "time_block",
      timeBlockId: b.id,
      clientId: b.client_id,
    },
  };
}

function defaultLabelForCategory(category: TimeBlockCategory): string {
  switch (category) {
    case "sonography":
      return "Sonography";
    case "work_block":
      return "Work";
    case "blocked":
      return "Unavailable";
  }
}

/** Fetch a single shoot by id, or null if not found. */
export async function fetchShoot(id: string): Promise<ShootRecord | null> {
  if (!id) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ShootRecord | null) ?? null;
}

/** Fetch a single time_block by id, or null if not found. */
export async function fetchTimeBlock(
  id: string
): Promise<TimeBlockRecord | null> {
  if (!id) return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("time_blocks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TimeBlockRecord | null) ?? null;
}

/** {id, name}[] of all clients, ordered by name. Used by the form pickers. */
export async function fetchClientsLite(): Promise<
  Array<{ id: string; name: string }>
> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; name: string }>;
}

async function fetchClientNames(
  supabase: SupabaseClient,
  clientIds: string[]
): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (error) throw new Error(error.message);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as Pick<ClientRecord, "id" | "name">[]) {
    out.set(row.id, row.name);
  }
  return out;
}
