import {
  getSupabaseServiceClient,
  type RecurringExpenseTemplateRecord,
} from "@/lib/supabase";

// `fetchAppSettings` lives in the financials module because that's the
// feature it shipped with. Re-export here so the settings page can import
// from a single feature-local module without reaching across feature
// boundaries at every call site.
export { fetchAppSettings } from "@/app/owner/financials/_lib/queries";

/**
 * Admin-surface read: every recurring expense template, active first, alpha
 * within. Unlike the financials suggestion query (which filters
 * `active = true`), this returns inactive rows too so Kelsey can toggle
 * them back on or delete them.
 */
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
