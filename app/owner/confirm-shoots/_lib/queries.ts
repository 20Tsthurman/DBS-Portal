import {
  getSupabaseServiceClient,
  type ExternalEventRecord,
  type GoogleSyncedCalendarRecord,
} from "@/lib/supabase";

/**
 * One row in the Confirm Shoots queue — a Google event whose title matched
 * the shoot|content rule, awaiting Kelsey's client pick. Display-safe shape;
 * timestamps stay ISO strings and are formatted client-side via the
 * calendar's timezone helpers.
 */
export interface PendingCandidate {
  id: string;
  title: string;
  /** Display name of the source calendar (falls back to its raw id). */
  calendarName: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  htmlLink: string | null;
}

type CandidateRow = Pick<
  ExternalEventRecord,
  | "id"
  | "calendar_id"
  | "title"
  | "starts_at"
  | "ends_at"
  | "all_day"
  | "location"
  | "html_link"
>;

/** Pending candidates, soonest first. */
export async function fetchPendingCandidates(): Promise<PendingCandidate[]> {
  const supabase = getSupabaseServiceClient();

  const [eventsRes, calendarsRes] = await Promise.all([
    supabase
      .from("external_events")
      .select(
        "id, calendar_id, title, starts_at, ends_at, all_day, location, html_link"
      )
      .eq("status", "confirmed")
      .eq("shoot_candidate", "pending")
      .order("starts_at", { ascending: true }),
    supabase.from("google_synced_calendars").select("calendar_id, summary"),
  ]);

  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (calendarsRes.error) throw new Error(calendarsRes.error.message);

  const nameByCalendarId = new Map<string, string>();
  for (const cal of (calendarsRes.data ?? []) as Pick<
    GoogleSyncedCalendarRecord,
    "calendar_id" | "summary"
  >[]) {
    nameByCalendarId.set(cal.calendar_id, cal.summary?.trim() || cal.calendar_id);
  }

  return ((eventsRes.data ?? []) as CandidateRow[]).map((row) => ({
    id: row.id,
    title: row.title?.trim() || "(No title)",
    calendarName: nameByCalendarId.get(row.calendar_id) ?? row.calendar_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    location: row.location,
    htmlLink: row.html_link,
  }));
}
