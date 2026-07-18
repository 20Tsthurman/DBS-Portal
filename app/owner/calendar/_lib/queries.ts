import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ExternalEventRecord,
  type ShootRecord,
  type ShootStatus,
  type TimeBlockCategory,
  type TimeBlockRecord,
} from "@/lib/supabase";
import { dateKey } from "./dateMath";
import {
  combineDateAndTimeInTimezone,
} from "./timezone";
import { dateKeyInTimezone } from "@/lib/date";
import type { CalendarEvent } from "./types";

type ShootLite = Pick<
  ShootRecord,
  | "id"
  | "client_id"
  | "scheduled_at"
  | "duration_hours"
  | "location"
  | "status"
  | "kind"
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

type ExternalEventLite = Pick<
  ExternalEventRecord,
  "id" | "title" | "starts_at" | "ends_at" | "all_day" | "html_link"
>;

/**
 * Fetch every event (shoots + time_blocks + imported Google events)
 * overlapping [start, end) and return them as a single sorted
 * `CalendarEvent[]`. Used by the owner Week / Month / Agenda views.
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

  const [shootsRes, blocksRes, externalRes] = await Promise.all([
    supabase
      .from("shoots")
      .select(
        "id, client_id, scheduled_at, duration_hours, location, status, kind"
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
    // Exact-instant overlap directly in SQL (both bounds are timestamptz).
    // Tombstoned (cancelled-in-Google) rows never render.
    supabase
      .from("external_events")
      .select("id, title, starts_at, ends_at, all_day, html_link")
      .eq("status", "confirmed")
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString()),
  ]);

  if (shootsRes.error) throw new Error(shootsRes.error.message);
  if (blocksRes.error) throw new Error(blocksRes.error.message);
  if (externalRes.error) throw new Error(externalRes.error.message);

  const shoots = (shootsRes.data ?? []) as ShootLite[];
  const blocks = (blocksRes.data ?? []) as TimeBlockLite[];
  const externals = (externalRes.data ?? []) as ExternalEventLite[];

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
  for (const x of externals) {
    events.push(externalEventToEvent(x));
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
    category: s.kind === "meeting" ? "meeting" : "shoot",
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

function externalEventToEvent(x: ExternalEventLite): CalendarEvent {
  const startsAt = new Date(x.starts_at);
  const endsAt = new Date(x.ends_at);
  return {
    id: `external:${x.id}`,
    category: "external",
    dateKey: dateKeyInTimezone(startsAt),
    startsAt,
    endsAt,
    title: x.title?.trim() || "(No title)",
    subtitle: null,
    status: "confirmed",
    source: {
      kind: "external",
      externalEventId: x.id,
      htmlLink: x.html_link,
      allDay: x.all_day,
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

export interface PendingShoot {
  id: string;
  scheduled_at: string;
  duration_hours: number | null;
  location: string | null;
  notes: string | null;
  client_id: string;
  client_name: string;
}

/**
 * Pending (client-requested, not yet acted on) shoots whose scheduled_at is in
 * the future. Used by the owner's "Pending Requests" bar so Kelsey can see and
 * confirm/decline them without opening each one.
 */
export async function fetchPendingShoots(): Promise<PendingShoot[]> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const { data: shoots, error: shootsError } = await supabase
    .from("shoots")
    .select("id, client_id, scheduled_at, duration_hours, location, notes")
    .eq("status", "requested")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });

  if (shootsError) throw new Error(shootsError.message);

  const rows = (shoots ?? []) as Array<
    Pick<
      ShootRecord,
      "id" | "client_id" | "scheduled_at" | "duration_hours" | "location" | "notes"
    >
  >;
  if (rows.length === 0) return [];

  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
  const nameById = await fetchClientNames(supabase, clientIds);

  return rows.map((r) => ({
    id: r.id,
    scheduled_at: r.scheduled_at,
    duration_hours: r.duration_hours,
    location: r.location,
    notes: r.notes,
    client_id: r.client_id,
    client_name: nameById.get(r.client_id) ?? "Unknown client",
  }));
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
