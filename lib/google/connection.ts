import type { Auth } from "googleapis";
import {
  getSupabaseServiceClient,
  type GoogleCalendarConnectionRecord,
  type GoogleSyncedCalendarRecord,
} from "@/lib/supabase";
import { getGoogleOAuthClient } from "./oauth";
import { decryptToken, encryptToken } from "./tokenCrypto";

/**
 * The google_calendar_connection singleton row (0 or 1 rows), plus an
 * auto-refreshing OAuth client built from it. All Google API calls go
 * through `getAuthorizedClient()` so refreshed access tokens are written
 * back to the row instead of being re-minted on every request.
 *
 * The refresh_token column holds the AES-256-GCM-encrypted form (see
 * ./tokenCrypto). `fetchGoogleConnection` returns the row as stored;
 * use {@link getDecryptedRefreshToken} for the plaintext.
 */

export async function fetchGoogleConnection(): Promise<GoogleCalendarConnectionRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("google_calendar_connection")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as GoogleCalendarConnectionRecord | null) ?? null;
}

export interface SaveConnectionInput {
  /** Plaintext refresh token from the OAuth exchange — encrypted before storage. */
  refresh_token: string;
  access_token: string | null;
  token_expiry: string | null;
  /** Space-separated scope list from the token response (write-scope detection). */
  granted_scopes: string | null;
}

/**
 * Plaintext refresh token for a stored connection, or null when it can't be
 * decrypted (missing/rotated GOOGLE_TOKEN_ENCRYPTION_KEY, tampered value).
 * Callers treat null as "effectively not connected" — reconnecting writes a
 * fresh token, so there is no recovery path to build here.
 */
export function getDecryptedRefreshToken(
  connection: GoogleCalendarConnectionRecord
): string | null {
  return decryptToken(connection.refresh_token);
}

/**
 * Create-or-replace the singleton after an OAuth exchange. A fresh grant is
 * a clean slate: the calendar selection resets to just the primary calendar,
 * and the imported mirror is wiped so events from previously-selected
 * calendars can't linger with no calendar row left to refresh or tombstone
 * them. The first sync after connect is a full-window fetch.
 */
export async function saveGoogleConnection(
  input: SaveConnectionInput
): Promise<GoogleCalendarConnectionRecord> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("google_calendar_connection")
    .upsert(
      {
        singleton: true,
        refresh_token: encryptToken(input.refresh_token),
        access_token: input.access_token,
        token_expiry: input.token_expiry,
        granted_scopes: input.granted_scopes,
        // Push target re-resolves on the first push under the new grant.
        push_calendar_id: null,
        push_calendar_summary: null,
        last_synced_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "singleton" }
    )
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save Google connection");
  }

  const { error: eventsError } = await supabase
    .from("external_events")
    .delete()
    .neq("google_event_id", "");
  if (eventsError) throw new Error(eventsError.message);

  const { error: calsError } = await supabase
    .from("google_synced_calendars")
    .delete()
    .neq("calendar_id", "");
  if (calsError) throw new Error(calsError.message);

  const { error: seedError } = await supabase
    .from("google_synced_calendars")
    .insert({ calendar_id: "primary", summary: "Primary calendar" });
  if (seedError) throw new Error(seedError.message);

  return data as GoogleCalendarConnectionRecord;
}

/** The calendars selected for import, in stable (insertion) order. */
export async function fetchSyncedCalendars(): Promise<GoogleSyncedCalendarRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("google_synced_calendars")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GoogleSyncedCalendarRecord[];
}

/** Per-calendar partial update (sync token, sync stamp, display snapshots). */
export async function updateSyncedCalendar(
  calendarId: string,
  patch: Partial<
    Pick<
      GoogleSyncedCalendarRecord,
      "sync_token" | "last_synced_at" | "summary" | "color"
    >
  >
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("google_synced_calendars")
    .update(patch)
    .eq("calendar_id", calendarId);
  if (error) throw new Error(error.message);
}

/**
 * Select a calendar for import. sync_token starts NULL so the next sync
 * does a full-window fetch for it. No-op if already selected.
 */
export async function addSyncedCalendar(input: {
  calendar_id: string;
  summary: string | null;
  color: string | null;
}): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("google_synced_calendars")
    .upsert(
      {
        calendar_id: input.calendar_id,
        summary: input.summary,
        color: input.color,
      },
      { onConflict: "calendar_id" }
    );
  if (error) throw new Error(error.message);
}

/**
 * Deselect a calendar: drop its selection row AND its imported events, so
 * they stop rendering and stop blocking client bookings immediately.
 * Re-selecting later recreates the row with a NULL token → clean full sync.
 */
export async function removeSyncedCalendar(calendarId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error: eventsError } = await supabase
    .from("external_events")
    .delete()
    .eq("calendar_id", calendarId);
  if (eventsError) throw new Error(eventsError.message);
  const { error } = await supabase
    .from("google_synced_calendars")
    .delete()
    .eq("calendar_id", calendarId);
  if (error) throw new Error(error.message);
}

/** Partial update on the singleton (last_synced_at, token cache, push target). */
export async function updateGoogleConnection(
  patch: Partial<
    Pick<
      GoogleCalendarConnectionRecord,
      | "access_token"
      | "token_expiry"
      | "last_synced_at"
      | "push_calendar_id"
      | "push_calendar_summary"
    >
  >
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("google_calendar_connection")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

/**
 * Delete the connection row, the calendar selection, AND the imported
 * mirror. Leaving external_events behind after a disconnect would keep
 * ghost events on the calendar and keep blocking client bookings with data
 * that can no longer be refreshed.
 */
export async function clearGoogleConnection(): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error: eventsError } = await supabase
    .from("external_events")
    .delete()
    .neq("google_event_id", "");
  if (eventsError) throw new Error(eventsError.message);
  const { error: calsError } = await supabase
    .from("google_synced_calendars")
    .delete()
    .neq("calendar_id", "");
  if (calsError) throw new Error(calsError.message);
  const { error } = await supabase
    .from("google_calendar_connection")
    .delete()
    .eq("singleton", true);
  if (error) throw new Error(error.message);
}

/**
 * OAuth client seeded with the stored credentials. googleapis refreshes the
 * access token automatically when it's expired; the `tokens` listener
 * persists the refreshed token back onto the row (fire-and-forget — a failed
 * cache write only costs an extra refresh next time).
 */
export async function getAuthorizedClient(): Promise<{
  auth: Auth.OAuth2Client;
  connection: GoogleCalendarConnectionRecord;
} | null> {
  const connection = await fetchGoogleConnection();
  if (!connection) return null;

  const refreshToken = getDecryptedRefreshToken(connection);
  if (!refreshToken) {
    console.error(
      "[google-connection] stored refresh token could not be decrypted — treating as not connected (reconnect from /owner/settings)"
    );
    return null;
  }

  const auth = getGoogleOAuthClient();
  auth.setCredentials({
    refresh_token: refreshToken,
    access_token: connection.access_token ?? undefined,
    expiry_date: connection.token_expiry
      ? new Date(connection.token_expiry).getTime()
      : undefined,
  });
  auth.on("tokens", (tokens) => {
    if (!tokens.access_token) return;
    void updateGoogleConnection({
      access_token: tokens.access_token,
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    }).catch((err) =>
      console.error("[google-connection] failed to cache refreshed token", err)
    );
  });

  return { auth, connection };
}
