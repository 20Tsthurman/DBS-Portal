import type { calendar_v3 } from "googleapis";
import type { Auth } from "googleapis";
import {
  getSupabaseServiceClient,
  type GoogleCalendarConnectionRecord,
  type ShootRecord,
} from "@/lib/supabase";
import { PORTAL_TIMEZONE } from "@/app/owner/calendar/_lib/timezone";
import {
  deleteEvent,
  getCalendarApi,
  insertEvent,
  isMissingEventError,
  listCalendars,
  patchEvent,
  PORTAL_SOURCE_KEY,
} from "./calendar";
import { getAuthorizedClient, updateGoogleConnection } from "./connection";
import { hasWriteScope } from "./oauth";

/**
 * Portal → Google push (Stage 3).
 *
 * The portal is the system of record for shoots; Google is a mirror so
 * Kelsey sees bookings on her phone. Strictly one-way: pushed events carry
 * the PORTAL_SOURCE_KEY stamp and the importer skips them, so nothing
 * round-trips back in.
 *
 * The push rule, by shoot status:
 *   confirmed / completed              → the event should exist (insert or patch)
 *   requested / cancelled / declined   → the event should NOT exist (delete if pushed)
 * Client-requested shoots therefore appear in Google at the moment Kelsey
 * confirms them.
 *
 * Every entry point is NON-FATAL from the caller's perspective: a Google
 * failure logs, sets shoots.google_sync_pending, and never blocks saving a
 * shoot. retryPendingGooglePushes() sweeps the flag (plus the one-time
 * backfill of future confirmed shoots that predate Stage 3) on every sync.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Push target, matched by calendar summary (case-insensitive, trimmed). */
const PUSH_TARGET_SUMMARY = "digital bloom";

function shouldExistInGoogle(shoot: ShootRecord): boolean {
  return shoot.status === "confirmed" || shoot.status === "completed";
}

/**
 * Push a shoot's current state to Google, never throwing at the caller.
 * On any failure the shoot is marked google_sync_pending for the sweep.
 */
export async function syncShootToGoogleNonFatal(
  shoot: ShootRecord
): Promise<void> {
  try {
    await syncShootToGoogle(shoot);
  } catch (err) {
    console.error(`[google-push] push failed for shoot ${shoot.id}`, err);
    await setSyncPending(shoot.id, true).catch((flagErr) =>
      console.error(
        `[google-push] failed to flag shoot ${shoot.id} for retry`,
        flagErr
      )
    );
  }
}

/**
 * Core push. Throws on Google/DB errors (callers wrap). Not connected or
 * missing write scope is NOT an error: the shoot is flagged pending when
 * there's something to do, so everything catches up after Kelsey reconnects
 * with the write scope.
 */
async function syncShootToGoogle(shoot: ShootRecord): Promise<void> {
  const needsAction = shouldExistInGoogle(shoot) || Boolean(shoot.google_event_id);

  const authorized = await getAuthorizedClient();
  if (!authorized || !hasWriteScope(authorized.connection.granted_scopes)) {
    await setSyncPending(shoot.id, needsAction);
    return;
  }
  const { auth, connection } = authorized;
  const api = getCalendarApi(auth);

  if (!shouldExistInGoogle(shoot)) {
    // requested / cancelled / declined — remove the mirror if one exists.
    if (shoot.google_event_id) {
      await deleteEvent(
        api,
        shoot.google_calendar_id ?? "primary",
        shoot.google_event_id
      );
      await stampShoot(shoot.id, {
        google_event_id: null,
        google_calendar_id: null,
        google_sync_pending: false,
      });
    } else {
      await setSyncPending(shoot.id, false);
    }
    return;
  }

  const payload = await buildShootEvent(shoot);

  if (shoot.google_event_id) {
    const calendarId = shoot.google_calendar_id ?? "primary";
    try {
      await patchEvent(api, calendarId, shoot.google_event_id, payload);
      await setSyncPending(shoot.id, false);
      return;
    } catch (err) {
      if (!isMissingEventError(err)) throw err;
      // The mirror was deleted in Google — fall through and insert a fresh
      // one (portal is the source of truth).
    }
  }

  const target = await resolvePushTarget(auth, connection);
  const eventId = await insertEvent(api, target.id, payload);
  await stampShoot(shoot.id, {
    google_event_id: eventId,
    google_calendar_id: target.id,
    google_sync_pending: false,
  });
}

/**
 * Best-effort Google delete for an already-deleted shoot row (the id was
 * captured before the row died). No retry handle exists if this fails —
 * the orphaned Google event is logged for manual cleanup. Rare by design.
 */
export async function deleteGoogleEventNonFatal(
  calendarId: string | null,
  eventId: string | null
): Promise<void> {
  if (!eventId) return;
  try {
    const authorized = await getAuthorizedClient();
    if (!authorized || !hasWriteScope(authorized.connection.granted_scopes)) {
      console.error(
        `[google-push] cannot delete Google event ${eventId} (no writable connection) — remove it in Google Calendar by hand`
      );
      return;
    }
    await deleteEvent(
      getCalendarApi(authorized.auth),
      calendarId ?? "primary",
      eventId
    );
  } catch (err) {
    console.error(
      `[google-push] orphaned Google event ${eventId} — remove it in Google Calendar by hand`,
      err
    );
  }
}

/**
 * Sweep run on every sync (cron + sync-on-view). Two arms:
 *   1. google_sync_pending — pushes that failed (or were saved before the
 *      write scope existed).
 *   2. Backfill — FUTURE confirmed/completed shoots that have never been
 *      pushed (google_event_id IS NULL). This is what publishes shoots that
 *      predate Stage 3 without Kelsey editing each one. Idempotent: a
 *      successful push stores google_event_id, which removes the shoot from
 *      this arm forever, and the partial unique index backstops duplicates.
 * No-op until a writable (re-consented) connection exists.
 */
export async function retryPendingGooglePushes(): Promise<{
  attempted: number;
  failed: number;
}> {
  const authorized = await getAuthorizedClient();
  if (!authorized || !hasWriteScope(authorized.connection.granted_scopes)) {
    return { attempted: 0, failed: 0 };
  }

  const supabase = getSupabaseServiceClient();
  const [pendingRes, backfillRes] = await Promise.all([
    supabase.from("shoots").select("*").eq("google_sync_pending", true),
    supabase
      .from("shoots")
      .select("*")
      .is("google_event_id", null)
      .in("status", ["confirmed", "completed"])
      .gte("scheduled_at", new Date().toISOString()),
  ]);
  if (pendingRes.error) throw new Error(pendingRes.error.message);
  if (backfillRes.error) throw new Error(backfillRes.error.message);

  const byId = new Map<string, ShootRecord>();
  for (const row of [
    ...((pendingRes.data ?? []) as ShootRecord[]),
    ...((backfillRes.data ?? []) as ShootRecord[]),
  ]) {
    byId.set(row.id, row);
  }

  let failed = 0;
  for (const shoot of byId.values()) {
    try {
      await syncShootToGoogle(shoot);
    } catch (err) {
      failed += 1;
      console.error(`[google-push] retry failed for shoot ${shoot.id}`, err);
      await setSyncPending(shoot.id, true).catch(() => {});
    }
  }
  return { attempted: byId.size, failed };
}

/**
 * The cached push target, resolving it on first use: the calendar whose
 * summary is "digital bloom" (case-insensitive), else the primary calendar.
 * Cached on the connection row and shown in settings; cleared on reconnect.
 */
async function resolvePushTarget(
  auth: Auth.OAuth2Client,
  connection: GoogleCalendarConnectionRecord
): Promise<{ id: string; summary: string }> {
  if (connection.push_calendar_id) {
    return {
      id: connection.push_calendar_id,
      summary: connection.push_calendar_summary ?? connection.push_calendar_id,
    };
  }

  const calendars = await listCalendars(auth);
  const match = calendars.find(
    (c) => c.summary.trim().toLowerCase() === PUSH_TARGET_SUMMARY
  );
  const target = match ??
    calendars.find((c) => c.primary) ?? {
      id: "primary",
      summary: "Primary calendar",
    };

  await updateGoogleConnection({
    push_calendar_id: target.id,
    push_calendar_summary: target.summary,
  });
  return { id: target.id, summary: target.summary };
}

/**
 * The Google mirror of a shoot. UTC instants with an explicit
 * PORTAL_TIMEZONE — never hand-rolled wall-clock parsing. End defaults to
 * one hour when the shoot has no duration, matching the booking-conflict
 * convention. The PORTAL_SOURCE_KEY stamp is the echo-loop guard.
 */
async function buildShootEvent(
  shoot: ShootRecord
): Promise<calendar_v3.Schema$Event> {
  const clientName = await fetchClientName(shoot.client_id);
  const startsAt = new Date(shoot.scheduled_at);
  const hours = shoot.duration_hours ? Number(shoot.duration_hours) : 1;
  const endsAt = new Date(startsAt.getTime() + hours * HOUR_MS);

  return {
    summary: `${shoot.kind === "meeting" ? "Meeting" : "Shoot"} — ${clientName}`,
    location: shoot.location ?? undefined,
    description: shoot.notes ?? undefined,
    start: { dateTime: startsAt.toISOString(), timeZone: PORTAL_TIMEZONE },
    end: { dateTime: endsAt.toISOString(), timeZone: PORTAL_TIMEZONE },
    extendedProperties: {
      private: { [PORTAL_SOURCE_KEY]: `shoot:${shoot.id}` },
    },
  };
}

async function fetchClientName(clientId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { name: string } | null)?.name ?? "Client";
}

async function stampShoot(
  shootId: string,
  patch: Partial<
    Pick<
      ShootRecord,
      "google_event_id" | "google_calendar_id" | "google_sync_pending"
    >
  >
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("shoots")
    .update(patch)
    .eq("id", shootId);
  if (error) throw new Error(error.message);
}

async function setSyncPending(shootId: string, pending: boolean): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("shoots")
    .update({ google_sync_pending: pending })
    .eq("id", shootId);
  if (error) throw new Error(error.message);
}
