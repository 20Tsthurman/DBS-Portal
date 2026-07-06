import {
  getSupabaseServiceClient,
  type RecurringExpenseTemplateRecord,
} from "@/lib/supabase";
import { fetchGoogleConnection } from "@/lib/google/connection";
import type { GoogleCalendarStatus } from "./types";

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
  const connection = await fetchGoogleConnection();
  if (!connection) {
    return { connected: false, lastSyncedAt: null, calendarId: null };
  }
  return {
    connected: true,
    lastSyncedAt: connection.last_synced_at,
    calendarId: connection.calendar_id,
  };
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
