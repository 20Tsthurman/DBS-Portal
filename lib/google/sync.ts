import {
  getSupabaseServiceClient,
  type ExternalEventRecord,
  type GoogleSyncedCalendarRecord,
} from "@/lib/supabase";
import { combineDateAndTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import {
  getCalendarApi,
  listEventsIncremental,
  type GoogleEvent,
} from "./calendar";
import {
  fetchSyncedCalendars,
  getAuthorizedClient,
  updateGoogleConnection,
  updateSyncedCalendar,
} from "./connection";
import type { calendar_v3 } from "googleapis";

/**
 * Google → Portal sync (Stage 1's only direction), across every calendar
 * selected in google_synced_calendars.
 *
 * Google sync tokens are PER-CALENDAR, so each selected calendar carries its
 * own sync_token and syncs independently: incremental when a token is held,
 * full-window on first run (or token expiry / re-selection). Events land in
 * external_events keyed on (calendar_id, google_event_id); cancellations
 * become status:'cancelled' tombstones scoped to their calendar.
 *
 * One calendar failing (revoked share, transient API error) does not abort
 * the others — failures are collected and reported on the result.
 */

export type SyncResult =
  | { status: "not_connected" }
  | { status: "skipped_recent"; lastSyncedAt: string }
  | {
      status: "synced";
      /** True when anything was written — callers use this to refresh views. */
      changed: boolean;
      upserted: number;
      cancelled: number;
      fullResync: boolean;
      /** Rows newly flagged into the Confirm Shoots queue this run. */
      candidatesFlagged: number;
      /** Calendar ids whose sync threw; the rest completed normally. */
      failedCalendarIds: string[];
    };

/**
 * Echo-loop guard, scaffolded for Stage 3. Once the portal writes shoots to
 * Google it stamps them with this extendedProperties.private key; the import
 * must skip them or every portal shoot would come back as a duplicate
 * external event. Inert in Stage 1 (nothing writes the stamp yet).
 */
const PORTAL_SOURCE_KEY = "dbsPortalSource";

function isPortalAuthoredEvent(event: GoogleEvent): boolean {
  return Boolean(event.extendedProperties?.private?.[PORTAL_SOURCE_KEY]);
}

/**
 * Shoot-capture title rule: an event whose title contains "shoot" or
 * "content" (case-insensitive) is a candidate for the Confirm Shoots queue.
 * Kept as ILIKE patterns because detection runs as SQL updates over the
 * whole calendar (see flagShootCandidates) — this catches rows imported
 * before the feature existed, not just the current batch.
 */
const CANDIDATE_TITLE_PATTERNS = ["%shoot%", "%content%"];

interface SyncOptions {
  /**
   * Skip entirely if the last sync completed within this window. Used by the
   * sync-on-view trigger so opening the calendar repeatedly doesn't hammer
   * the Google API. Omit (cron, post-connect, selection change) to always
   * sync.
   */
  skipIfSyncedWithinMs?: number;
}

export async function syncFromGoogle(
  options: SyncOptions = {}
): Promise<SyncResult> {
  const authorized = await getAuthorizedClient();
  if (!authorized) return { status: "not_connected" };
  const { auth, connection } = authorized;

  if (
    options.skipIfSyncedWithinMs !== undefined &&
    connection.last_synced_at &&
    Date.now() - new Date(connection.last_synced_at).getTime() <
      options.skipIfSyncedWithinMs
  ) {
    return { status: "skipped_recent", lastSyncedAt: connection.last_synced_at };
  }

  const calendarApi = getCalendarApi(auth);
  const calendars = await fetchSyncedCalendars();

  let upserted = 0;
  let cancelled = 0;
  let fullResync = false;
  let candidatesFlagged = 0;
  const failedCalendarIds: string[] = [];
  const nowIso = new Date().toISOString();

  for (const cal of calendars) {
    try {
      const result = await syncOneCalendar(calendarApi, cal, nowIso);
      upserted += result.upserted;
      cancelled += result.cancelled;
      fullResync = fullResync || result.fullResync;
      candidatesFlagged += result.candidatesFlagged;
    } catch (err) {
      console.error(
        `[google-sync] calendar "${cal.calendar_id}" sync failed`,
        err
      );
      failedCalendarIds.push(cal.calendar_id);
    }
  }

  // The connection-level stamp drives the 60s sync-on-view skip window and
  // the settings display. Don't stamp a total failure — that would hide a
  // broken sync behind the skip window instead of retrying.
  if (calendars.length === 0 || failedCalendarIds.length < calendars.length) {
    await updateGoogleConnection({ last_synced_at: nowIso });
  }

  return {
    status: "synced",
    changed: upserted > 0 || cancelled > 0 || candidatesFlagged > 0,
    upserted,
    cancelled,
    fullResync,
    candidatesFlagged,
    failedCalendarIds,
  };
}

async function syncOneCalendar(
  calendarApi: calendar_v3.Calendar,
  cal: GoogleSyncedCalendarRecord,
  nowIso: string
): Promise<{
  upserted: number;
  cancelled: number;
  fullResync: boolean;
  candidatesFlagged: number;
}> {
  const { items, nextSyncToken, fullResyncPerformed } =
    await listEventsIncremental(calendarApi, cal.calendar_id, cal.sync_token);

  const upserts: Array<
    Pick<
      ExternalEventRecord,
      | "calendar_id"
      | "google_event_id"
      | "title"
      | "starts_at"
      | "ends_at"
      | "all_day"
      | "busy"
      | "status"
      | "html_link"
      | "location"
    > & { updated_at: string }
  > = [];
  const cancelledIds: string[] = [];

  for (const event of items) {
    if (!event.id) continue;
    if (isPortalAuthoredEvent(event)) continue;

    if (event.status === "cancelled") {
      // Tombstones arrive without start/end — flip the existing row only.
      cancelledIds.push(event.id);
      continue;
    }

    const mapped = mapEventTimes(event);
    if (!mapped) continue;

    upserts.push({
      calendar_id: cal.calendar_id,
      google_event_id: event.id,
      title: event.summary?.trim() || null,
      starts_at: mapped.startsAt.toISOString(),
      ends_at: mapped.endsAt.toISOString(),
      all_day: mapped.allDay,
      // Google's busy/free signal. The API omits transparency for "Busy"
      // events (opaque is the default) and sends 'transparent' for "Free"
      // ones — which is what all-day events default to in the Google UI.
      busy: event.transparency !== "transparent",
      status: "confirmed",
      html_link: event.htmlLink ?? null,
      // NOTE: the payload never includes shoot_candidate/converted_shoot_id —
      // re-syncs must not overwrite Kelsey's confirm/dismiss decisions.
      location: event.location?.trim() || null,
      updated_at: nowIso,
    });
  }

  const supabase = getSupabaseServiceClient();

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("external_events")
      .upsert(upserts, { onConflict: "calendar_id,google_event_id" });
    if (error) throw new Error(`external_events upsert failed: ${error.message}`);
  }

  if (cancelledIds.length > 0) {
    const { error } = await supabase
      .from("external_events")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("calendar_id", cal.calendar_id)
      .in("google_event_id", cancelledIds);
    if (error) {
      throw new Error(`external_events cancel update failed: ${error.message}`);
    }
  }

  const candidatesFlagged = await flagShootCandidates(cal.calendar_id);

  await updateSyncedCalendar(cal.calendar_id, {
    sync_token: nextSyncToken,
    last_synced_at: nowIso,
  });

  return {
    upserted: upserts.length,
    cancelled: cancelledIds.length,
    fullResync: fullResyncPerformed,
    candidatesFlagged,
  };
}

/**
 * Candidate detection for the Confirm Shoots queue, run after each
 * calendar's upsert. Two whole-calendar SQL updates rather than per-batch id
 * lists — this also catches rows imported before the feature existed and
 * keeps URL lengths bounded on large full syncs.
 *
 *   1. Flag: title matches shoot|content AND shoot_candidate IS NULL →
 *      'pending'. The IS NULL guard means a dismissed or confirmed decision
 *      is never overridden by a re-sync.
 *   2. Unflag: a PENDING row whose title no longer matches (renamed away
 *      from Shoot/Content, or title removed) drops back to NULL and leaves
 *      the queue. Dismissed/confirmed rows are untouched.
 *
 * Returns how many rows were newly flagged.
 */
async function flagShootCandidates(calendarId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const [p1, p2] = CANDIDATE_TITLE_PATTERNS;

  const flagged = await supabase
    .from("external_events")
    .update({ shoot_candidate: "pending" })
    .eq("calendar_id", calendarId)
    .eq("status", "confirmed")
    .is("shoot_candidate", null)
    .or(`title.ilike.${p1},title.ilike.${p2}`)
    .select("id");
  if (flagged.error) {
    throw new Error(`candidate flagging failed: ${flagged.error.message}`);
  }

  const unflagged = await supabase
    .from("external_events")
    .update({ shoot_candidate: null })
    .eq("calendar_id", calendarId)
    .eq("shoot_candidate", "pending")
    .or(`title.is.null,and(title.not.ilike.${p1},title.not.ilike.${p2})`)
    .select("id");
  if (unflagged.error) {
    throw new Error(`candidate unflagging failed: ${unflagged.error.message}`);
  }

  return (flagged.data ?? []).length;
}

/**
 * Google's two event-time shapes:
 *   - timed:   start.dateTime / end.dateTime — RFC3339 instants with offset.
 *   - all-day: start.date / end.date — bare YYYY-MM-DD, end EXCLUSIVE.
 * All-day dates are wall-clock; anchor them to PORTAL_TIMEZONE midnights so
 * they cover the day Kelsey sees, not the UTC day.
 */
function mapEventTimes(
  event: GoogleEvent
): { startsAt: Date; endsAt: Date; allDay: boolean } | null {
  const start = event.start;
  const end = event.end;
  if (!start || !end) return null;

  if (start.dateTime && end.dateTime) {
    const startsAt = new Date(start.dateTime);
    const endsAt = new Date(end.dateTime);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return null;
    }
    return { startsAt, endsAt, allDay: false };
  }

  if (start.date && end.date) {
    return {
      startsAt: combineDateAndTimeInTimezone(start.date, "00:00"),
      endsAt: combineDateAndTimeInTimezone(end.date, "00:00"),
      allDay: true,
    };
  }

  return null;
}
