import {
  getSupabaseServiceClient,
  type RecurringExpenseTemplateRecord,
} from "@/lib/supabase";
import {
  fetchGoogleConnection,
  fetchSyncedCalendars,
  getAuthorizedClient,
  getDecryptedRefreshToken,
  updateSyncedCalendar,
} from "@/lib/google/connection";
import { listCalendars } from "@/lib/google/calendar";
import { hasWriteScope } from "@/lib/google/oauth";
import type { GoogleCalendarChoices, GoogleCalendarStatus } from "./types";

// `fetchAppSettings` lives in the financials module because that's the
// feature it shipped with. Re-export here so the settings page can import
// from a single feature-local module without reaching across feature
// boundaries at every call site.
export { fetchAppSettings } from "@/app/owner/financials/_lib/queries";

// `fetchActivePackages` lives in the clients module (it powers the package
// picker on the client form). Re-export here as `fetchPackages` so the
// settings page reads packages through a feature-local name. The underlying
// query is the same: select * ordered by monthly_price ascending.
export { fetchActivePackages as fetchPackages } from "@/app/owner/clients/_lib/queries";

/**
 * Admin-surface read: every recurring expense template, active first, alpha
 * within. Unlike the financials suggestion query (which filters
 * `active = true`), this returns inactive rows too so Kelsey can toggle
 * them back on or delete them.
 */
/**
 * Display-safe Google Calendar connection state for the settings section.
 * Never returns tokens — {@link GoogleCalendarStatus} is the boundary shape.
 */
export async function fetchGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const notConnected: GoogleCalendarStatus = {
    connected: false,
    lastSyncedAt: null,
    canPush: false,
    pushCalendarSummary: null,
  };
  const connection = await fetchGoogleConnection();
  if (!connection) return notConnected;
  // A row whose refresh token can't be decrypted (missing/rotated
  // GOOGLE_TOKEN_ENCRYPTION_KEY) can never sync — show it as not connected
  // so the Connect button is available and a re-grant overwrites the row.
  if (getDecryptedRefreshToken(connection) === null) return notConnected;
  return {
    connected: true,
    lastSyncedAt: connection.last_synced_at,
    canPush: hasWriteScope(connection.granted_scopes),
    pushCalendarSummary: connection.push_calendar_summary,
  };
}

/**
 * The calendar picker rows: the account's live calendar list (via
 * calendarList.list) merged with the stored selection. When Google is
 * unreachable, falls back to the stored rows alone (selected-only,
 * `live: false`) so the section still renders — just not editable.
 *
 * While the live list is in hand, stale summary/color snapshots on the
 * selected rows are refreshed opportunistically.
 */
export async function fetchGoogleCalendarChoices(): Promise<GoogleCalendarChoices> {
  const authorized = await getAuthorizedClient();
  if (!authorized) return { choices: [], live: false };

  const selectedRows = await fetchSyncedCalendars();
  const selectedById = new Map(selectedRows.map((r) => [r.calendar_id, r]));

  try {
    const live = await listCalendars(authorized.auth);

    for (const entry of live) {
      const row = selectedById.get(entry.id);
      if (row && (row.summary !== entry.summary || row.color !== entry.color)) {
        await updateSyncedCalendar(entry.id, {
          summary: entry.summary,
          color: entry.color,
        });
      }
    }

    return {
      live: true,
      choices: live.map((entry) => ({
        id: entry.id,
        name: entry.summary,
        color: entry.color,
        primary: entry.primary,
        selected: selectedById.has(entry.id),
      })),
    };
  } catch (err) {
    console.error("[settings] Google calendarList fetch failed", err);
    return {
      live: false,
      choices: selectedRows.map((row) => ({
        id: row.calendar_id,
        name: row.summary?.trim() || row.calendar_id,
        color: row.color,
        primary: row.calendar_id === "primary",
        selected: true,
      })),
    };
  }
}

export async function fetchAllTemplates(): Promise<
  RecurringExpenseTemplateRecord[]
> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("recurring_expense_templates")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecurringExpenseTemplateRecord[];
}
