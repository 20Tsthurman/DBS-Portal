import type { Auth } from "googleapis";
import {
  getSupabaseServiceClient,
  type GoogleCalendarConnectionRecord,
} from "@/lib/supabase";
import { getGoogleOAuthClient } from "./oauth";

/**
 * The google_calendar_connection singleton row (0 or 1 rows), plus an
 * auto-refreshing OAuth client built from it. All Google API calls go
 * through `getAuthorizedClient()` so refreshed access tokens are written
 * back to the row instead of being re-minted on every request.
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
  refresh_token: string;
  access_token: string | null;
  token_expiry: string | null;
}

/**
 * Create-or-replace the singleton after an OAuth exchange. A fresh grant
 * resets sync state (sync_token / last_synced_at) so the first sync after a
 * reconnect is a clean full-window fetch.
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
        refresh_token: input.refresh_token,
        access_token: input.access_token,
        token_expiry: input.token_expiry,
        calendar_id: "primary",
        sync_token: null,
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
  return data as GoogleCalendarConnectionRecord;
}

/** Partial update on the singleton (sync_token, last_synced_at, token cache). */
export async function updateGoogleConnection(
  patch: Partial<
    Pick<
      GoogleCalendarConnectionRecord,
      "access_token" | "token_expiry" | "sync_token" | "last_synced_at"
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
 * Delete the connection row AND the imported mirror. Leaving external_events
 * behind after a disconnect would keep ghost events on the calendar and keep
 * blocking client bookings with data that can no longer be refreshed.
 */
export async function clearGoogleConnection(): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error: eventsError } = await supabase
    .from("external_events")
    .delete()
    .neq("google_event_id", "");
  if (eventsError) throw new Error(eventsError.message);
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

  const auth = getGoogleOAuthClient();
  auth.setCredentials({
    refresh_token: connection.refresh_token,
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
