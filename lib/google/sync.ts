import {
  getSupabaseServiceClient,
  type ExternalEventRecord,
} from "@/lib/supabase";
import { combineDateAndTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import { getCalendarApi, listEventsIncremental, type GoogleEvent } from "./calendar";
import { getAuthorizedClient, updateGoogleConnection } from "./connection";

/**
 * Google → Portal sync (Stage 1's only direction).
 *
 * Incremental via the stored sync_token; the first run (or a token expiry /
 * reconnect) fetches the full window. Events land in external_events keyed
 * on google_event_id; cancellations become status:'cancelled' tombstones.
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

interface SyncOptions {
  /**
   * Skip entirely if the last sync completed within this window. Used by the
   * sync-on-view trigger so opening the calendar repeatedly doesn't hammer
   * the Google API. Omit (cron, post-connect) to always sync.
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

  const calendar = getCalendarApi(auth);
  const { items, nextSyncToken, fullResyncPerformed } =
    await listEventsIncremental(
      calendar,
      connection.calendar_id,
      connection.sync_token
    );

  const upserts: Array<
    Pick<
      ExternalEventRecord,
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
  const nowIso = new Date().toISOString();

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
      .upsert(upserts, { onConflict: "google_event_id" });
    if (error) throw new Error(`external_events upsert failed: ${error.message}`);
  }

  if (cancelledIds.length > 0) {
    const { error } = await supabase
      .from("external_events")
      .update({ status: "cancelled", updated_at: nowIso })
      .in("google_event_id", cancelledIds);
    if (error) {
      throw new Error(`external_events cancel update failed: ${error.message}`);
    }
  }

  await updateGoogleConnection({
    sync_token: nextSyncToken,
    last_synced_at: nowIso,
  });

  return {
    status: "synced",
    changed: upserts.length > 0 || cancelledIds.length > 0,
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
