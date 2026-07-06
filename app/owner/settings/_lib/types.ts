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
}

/** One checkbox row in the calendar picker. */
export interface CalendarChoice {
  /** Canonical id — 'primary' for the primary calendar (see lib/google/calendar.ts). */
  id: string;
  name: string;
  /** Google backgroundColor hex for the swatch, or null. */
  color: string | null;
  primary: boolean;
  /** Currently selected for import (has a google_synced_calendars row). */
  selected: boolean;
}

export interface GoogleCalendarChoices {
  choices: CalendarChoice[];
  /**
   * True when the list came from Google live; false when Google was
   * unreachable and only the stored (already-selected) rows are shown,
   * in which case editing is disabled.
   */
  live: boolean;
}
