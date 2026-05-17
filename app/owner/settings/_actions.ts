"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import {
  isPositiveFiniteNumber,
  isValidDayOfMonth,
} from "@/lib/validation";
import {
  getSupabaseServiceClient,
  type AppSettingsRecord,
  type ExpenseCategory,
  type RecurringExpenseTemplateRecord,
} from "@/lib/supabase";
import type {
  CreateRecurringExpenseTemplateInput,
  UpdateAppSettingsInput,
  UpdateRecurringExpenseTemplateInput,
} from "./_lib/types";

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "platform_software",
  "marketing_advertising",
  "equipment_gear",
  "travel_transportation",
  "professional_services",
  "business_operations",
];

function revalidateBoth() {
  revalidatePath("/owner/settings");
  revalidatePath("/owner/financials");
}

// ---------------------------------------------------------------------------
// updateAppSettingsAction
//
// Writes the three editable fields on the app_settings singleton row plus
// `updated_at = now()`. home_address is allowed empty (mileage suggestions
// short-circuit gracefully when it is). Both mileage rate and tax percent
// are bounded at the DB layer; we validate at the action boundary too so
// the user gets a readable message instead of a CHECK violation string.
// ---------------------------------------------------------------------------
export async function updateAppSettingsAction(
  input: UpdateAppSettingsInput
): Promise<ActionResult<AppSettingsRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (typeof input.home_address !== "string") {
    return { ok: false, error: "Home address must be a string" };
  }
  if (
    typeof input.mileage_rate_per_mile !== "number" ||
    !Number.isFinite(input.mileage_rate_per_mile) ||
    input.mileage_rate_per_mile < 0
  ) {
    return { ok: false, error: "Mileage rate must be 0 or greater" };
  }
  if (
    typeof input.tax_set_aside_percent !== "number" ||
    !Number.isFinite(input.tax_set_aside_percent) ||
    input.tax_set_aside_percent < 0 ||
    input.tax_set_aside_percent > 100
  ) {
    return {
      ok: false,
      error: "Tax set-aside must be between 0 and 100",
    };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .update({
      home_address: input.home_address.trim(),
      mileage_rate_per_mile: input.mileage_rate_per_mile,
      tax_set_aside_percent: input.tax_set_aside_percent,
      updated_at: new Date().toISOString(),
    })
    .eq("singleton", true)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to update settings" };
  }
  revalidateBoth();
  return { ok: true, data: data as AppSettingsRecord };
}

// ---------------------------------------------------------------------------
// createRecurringExpenseTemplateAction
// ---------------------------------------------------------------------------
export async function createRecurringExpenseTemplateAction(
  input: CreateRecurringExpenseTemplateInput
): Promise<ActionResult<RecurringExpenseTemplateRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const trimmedName = typeof input.name === "string" ? input.name.trim() : "";
  if (!trimmedName) return { ok: false, error: "Name is required" };
  if (!EXPENSE_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Invalid category" };
  }
  if (!isPositiveFiniteNumber(input.amount)) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  if (!isValidDayOfMonth(input.day_of_month)) {
    return {
      ok: false,
      error: "Day of month must be a whole number between 1 and 28",
    };
  }

  const trimmedNotes =
    typeof input.notes === "string" && input.notes.trim().length > 0
      ? input.notes.trim()
      : null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("recurring_expense_templates")
    .insert({
      name: trimmedName,
      category: input.category,
      amount: input.amount,
      day_of_month: input.day_of_month,
      notes: trimmedNotes,
      active: true,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create template" };
  }
  revalidateBoth();
  return { ok: true, data: data as RecurringExpenseTemplateRecord };
}

// ---------------------------------------------------------------------------
// updateRecurringExpenseTemplateAction
//
// Partial-update pattern mirroring updateIncomePaymentAction
// (app/owner/financials/_actions.ts:110-166): only fields explicitly
// included in `updates` get written; an empty `updates` is rejected.
// ---------------------------------------------------------------------------
export async function updateRecurringExpenseTemplateAction(
  id: string,
  updates: UpdateRecurringExpenseTemplateInput
): Promise<ActionResult<RecurringExpenseTemplateRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing template id" };

  const patch: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    const trimmed = typeof updates.name === "string" ? updates.name.trim() : "";
    if (!trimmed) return { ok: false, error: "Name cannot be empty" };
    patch.name = trimmed;
  }
  if (updates.category !== undefined) {
    if (!EXPENSE_CATEGORIES.includes(updates.category)) {
      return { ok: false, error: "Invalid category" };
    }
    patch.category = updates.category;
  }
  if (updates.amount !== undefined) {
    if (!isPositiveFiniteNumber(updates.amount)) {
      return { ok: false, error: "Amount must be greater than 0" };
    }
    patch.amount = updates.amount;
  }
  if (updates.day_of_month !== undefined) {
    if (!isValidDayOfMonth(updates.day_of_month)) {
      return {
        ok: false,
        error: "Day of month must be a whole number between 1 and 28",
      };
    }
    patch.day_of_month = updates.day_of_month;
  }
  if (updates.notes !== undefined) {
    patch.notes =
      typeof updates.notes === "string" && updates.notes.trim().length > 0
        ? updates.notes.trim()
        : null;
  }
  if (updates.active !== undefined) {
    if (typeof updates.active !== "boolean") {
      return { ok: false, error: "Active must be true or false" };
    }
    patch.active = updates.active;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("recurring_expense_templates")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to update template" };
  }
  revalidateBoth();
  return { ok: true, data: data as RecurringExpenseTemplateRecord };
}

// ---------------------------------------------------------------------------
// toggleTemplateActiveAction
//
// Thin one-field update — useful as a stable handle for the table's Active
// checkbox without the caller having to assemble a patch shape.
// ---------------------------------------------------------------------------
export async function toggleTemplateActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult<RecurringExpenseTemplateRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing template id" };
  if (typeof active !== "boolean") {
    return { ok: false, error: "Active must be true or false" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("recurring_expense_templates")
    .update({ active })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to toggle template" };
  }
  revalidateBoth();
  return { ok: true, data: data as RecurringExpenseTemplateRecord };
}

// ---------------------------------------------------------------------------
// deleteRecurringExpenseTemplateAction
//
// Hard delete. Past expenses keep their rows but their `source_template_id`
// is set to NULL by the FK (migration 001_phase4_suggestions.sql:67-69:
// `references recurring_expense_templates(id) on delete set null`). Future
// suggestion suppression for those expenses falls back to the name-match
// path in computeExpenseSuggestions (suggestions.ts:203-205).
// ---------------------------------------------------------------------------
export async function deleteRecurringExpenseTemplateAction(
  id: string
): Promise<ActionResult<null>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing template id" };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("recurring_expense_templates")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateBoth();
  return { ok: true };
}
