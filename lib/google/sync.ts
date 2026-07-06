import {
  getSupabaseServiceClient,
  type ExternalEventRecord,
  type GoogleSyncedCalendarRecord,
} from "@/lib/supabase";
import { combineDateAndTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import {
  getCalendarApi,
  listEventsIncremental,
  PORTAL_SOURCE_KEY,
  type GoogleEvent,
} from "./calendar";
import {
  fetchSyncedCalendars,
  getAuthorizedClient,
  updateGoogleConnection,
  updateSyncedCalendar,
} from "./connection";
import { retryPendingGooglePushes } from "./push";
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
      /** Calendar ids whose sync threw; the rest completed normally. */
      failedCalendarIds: string[];
      /** Portal→Google sweep (retries + backfill): shoots attempted / still failing. */
      pushAttempted: number;
      pushFailed: number;
    };

/**
 * Echo-loop guard. Stage 3 stamps every pushed event with
 * extendedProperties.private[PORTAL_SOURCE_KEY]; the import skips them so a
 * portal shoot never round-trips back in as a busy block. Load-bearing:
 * the push target calendar is also imported.
 */
function isPortalAuthoredEvent(event: GoogleEvent): boolean {
  return Boolean(event.extendedProperties?.private?.[PORTAL_SOURCE_KEY]);
}

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
  const failedCalendarIds: string[] = [];
  const nowIso = new Date().toISOString();

  for (const cal of calendars) {
    try {
      const result = await syncOneCalendar(calendarApi, cal, nowIso);
      upserted += result.upserted;
      cancelled += result.cancelled;
      fullResync = fullResync || result.fullResync;
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

  // Portal → Google direction: sweep failed pushes + the one-time backfill.
  // Guarded so a push-side problem can never fail the import result.
  let pushAttempted = 0;
  let pushFailed = 0;
  try {
    const sweep = await retryPendingGooglePushes();
    pushAttempted = sweep.attempted;
    pushFailed = sweep.failed;
  } catch (err) {
    console.error("[google-sync] push sweep failed", err);
  }

  return {
    status: "synced",
    changed: upserted > 0 || cancelled > 0,
    upserted,
    cancelled,
    fullResync,
    failedCalendarIds,
    pushAttempted,
    pushFailed,
  };
}

async function syncOneCalendar(
  calendarApi: calendar_v3.Calendar,
  cal: GoogleSyncedCalendarRecord,
  nowIso: string
): Promise<{ upserted: number; cancelled: number; fullResync: boolean }> {
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

  await updateSyncedCalendar(cal.calendar_id, {
    sync_token: nextSyncToken,
    last_synced_at: nowIso,
  });

  return {
    upserted: upserts.length,
    cancelled: cancelledIds.length,
    fullResync: fullResyncPerformed,
  };
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
