import type { ExpenseCategory } from "@/lib/supabase";

export interface UpdateAppSettingsInput {
  home_address: string;
  mileage_rate_per_mile: number;
  tax_set_aside_percent: number;
}

export interface CreateRecurringExpenseTemplateInput {
  name: string;
  category: ExpenseCategory;
  amount: number;
  day_of_month: number;
  notes?: string | null;
}

export type UpdateRecurringExpenseTemplateInput = Partial<
  CreateRecurringExpenseTemplateInput
> & {
  active?: boolean;
};

export interface UpdatePackageInput {
  packageId: string;
  name?: string;
  monthlyPrice?: number;
  monthlyHours?: number;
}

/**
 * Connection state for the Google Calendar section. Deliberately excludes
 * tokens — only display-safe fields cross the server/client boundary.
 */
export interface GoogleCalendarStatus {
  connected: boolean;
  /** ISO timestamp of the last completed sync, or null before the first one. */
  lastSyncedAt: string | null;
  calendarId: string | null;
}
