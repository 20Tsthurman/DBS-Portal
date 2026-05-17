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
