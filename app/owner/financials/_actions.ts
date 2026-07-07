"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { monthRangeForKey } from "@/app/owner/calendar/_lib/timezone";
import { getMilesBetween } from "@/lib/google-maps";
import {
  getSupabaseServiceClient,
  type CashTaxClass,
  type ExpenseCategory,
  type ExpenseRecord,
  type IncomePaymentRecord,
  type IncomeType,
  type MileageLogRecord,
  type SuggestionType,
} from "@/lib/supabase";
import { isPositiveFiniteNumber, isValidDateKey } from "@/lib/validation";
import type { ActionResult } from "@/lib/actions";
import { fetchAppSettings } from "./_lib/queries";

const INCOME_TYPES: IncomeType[] = [
  "brand_retainer",
  "wedding_same_day",
  "one_off_shoot",
  "other",
];

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "platform_software",
  "marketing_advertising",
  "equipment_gear",
  "travel_transportation",
  "professional_services",
  "business_operations",
];

const CASH_TAX_CLASSES: CashTaxClass[] = ["both", "tax_only", "cash_only"];

const SUGGESTION_TYPES: SuggestionType[] = [
  "income_retainer",
  "mileage_shoot",
  "expense_template",
];

// ---------------------------------------------------------------------------
// income_payments
// ---------------------------------------------------------------------------

export interface AddIncomePaymentInput {
  payment_date: string;
  client_name_snapshot: string;
  amount: number;
  income_type: IncomeType;
  payment_method?: string | null;
  notes?: string | null;
}

export async function addIncomePaymentAction(
  input: AddIncomePaymentInput
): Promise<ActionResult<IncomePaymentRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!isValidDateKey(input.payment_date)) {
    return { ok: false, error: "Invalid date" };
  }
  const trimmedName = input.client_name_snapshot.trim();
  if (!trimmedName) return { ok: false, error: "Client name is required" };
  if (!isPositiveFiniteNumber(input.amount)) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  if (!INCOME_TYPES.includes(input.income_type)) {
    return { ok: false, error: "Invalid income type" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("income_payments")
    .insert({
      client_id: null,
      client_name_snapshot: trimmedName,
      payment_date: input.payment_date,
      amount: input.amount,
      income_type: input.income_type,
      payment_method: input.payment_method?.trim() || null,
      notes: input.notes?.trim() || null,
      logged_by: guard.ownerLabel,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to add income" };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as IncomePaymentRecord };
}

export type UpdateIncomePaymentInput = {
  payment_date?: string;
  client_name_snapshot?: string;
  amount?: number;
  income_type?: IncomeType;
  payment_method?: string | null;
  notes?: string | null;
};

export async function updateIncomePaymentAction(
  id: string,
  updates: UpdateIncomePaymentInput
): Promise<ActionResult<IncomePaymentRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing income payment id" };

  const patch: Record<string, unknown> = {};
  if (updates.payment_date !== undefined) {
    if (!isValidDateKey(updates.payment_date)) {
      return { ok: false, error: "Invalid date" };
    }
    patch.payment_date = updates.payment_date;
  }
  if (updates.client_name_snapshot !== undefined) {
    const trimmed = updates.client_name_snapshot.trim();
    if (!trimmed) return { ok: false, error: "Client name cannot be empty" };
    patch.client_name_snapshot = trimmed;
  }
  if (updates.amount !== undefined) {
    if (!isPositiveFiniteNumber(updates.amount)) {
      return { ok: false, error: "Amount must be greater than 0" };
    }
    patch.amount = updates.amount;
  }
  if (updates.income_type !== undefined) {
    if (!INCOME_TYPES.includes(updates.income_type)) {
      return { ok: false, error: "Invalid income type" };
    }
    patch.income_type = updates.income_type;
  }
  if (updates.payment_method !== undefined) {
    patch.payment_method = updates.payment_method?.trim() || null;
  }
  if (updates.notes !== undefined) {
    patch.notes = updates.notes?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No fields to update" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("income_payments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed" };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as IncomePaymentRecord };
}

export async function deleteIncomePaymentAction(
  id: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing income payment id" };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("income_payments")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner/financials");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// expenses
// ---------------------------------------------------------------------------

export interface AddExpenseInput {
  date: string;
  category: ExpenseCategory;
  amount: number;
  description?: string | null;
  notes?: string | null;
  /** Omitted = 'both' (the DB default). */
  cash_tax_class?: CashTaxClass;
}

export async function addExpenseAction(
  input: AddExpenseInput
): Promise<ActionResult<ExpenseRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!isValidDateKey(input.date)) {
    return { ok: false, error: "Invalid date" };
  }
  if (!EXPENSE_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Invalid category" };
  }
  if (!isPositiveFiniteNumber(input.amount)) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  if (
    input.cash_tax_class !== undefined &&
    !CASH_TAX_CLASSES.includes(input.cash_tax_class)
  ) {
    return { ok: false, error: "Invalid cash/tax class" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      date: input.date,
      category: input.category,
      amount: input.amount,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      cash_tax_class: input.cash_tax_class ?? "both",
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to add expense" };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as ExpenseRecord };
}

export type UpdateExpenseInput = {
  date?: string;
  category?: ExpenseCategory;
  description?: string | null;
  amount?: number;
  notes?: string | null;
  cash_tax_class?: CashTaxClass;
};

export async function updateExpenseAction(
  id: string,
  updates: UpdateExpenseInput
): Promise<ActionResult<ExpenseRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing expense id" };

  const patch: Record<string, unknown> = {};
  if (updates.date !== undefined) {
    if (!isValidDateKey(updates.date)) {
      return { ok: false, error: "Invalid date" };
    }
    patch.date = updates.date;
  }
  if (updates.category !== undefined) {
    if (!EXPENSE_CATEGORIES.includes(updates.category)) {
      return { ok: false, error: "Invalid category" };
    }
    patch.category = updates.category;
  }
  if (updates.description !== undefined) {
    patch.description = updates.description?.trim() || null;
  }
  if (updates.amount !== undefined) {
    if (!isPositiveFiniteNumber(updates.amount)) {
      return { ok: false, error: "Amount must be greater than 0" };
    }
    patch.amount = updates.amount;
  }
  if (updates.notes !== undefined) {
    patch.notes = updates.notes?.trim() || null;
  }
  if (updates.cash_tax_class !== undefined) {
    if (!CASH_TAX_CLASSES.includes(updates.cash_tax_class)) {
      return { ok: false, error: "Invalid cash/tax class" };
    }
    patch.cash_tax_class = updates.cash_tax_class;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No fields to update" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed" };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as ExpenseRecord };
}

export async function deleteExpenseAction(
  id: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing expense id" };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner/financials");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// mileage_logs
// ---------------------------------------------------------------------------

export interface AddMileageLogInput {
  trip_date: string;
  from_address: string;
  to_address: string;
  miles: number;
}

export async function addMileageLogAction(
  input: AddMileageLogInput
): Promise<ActionResult<MileageLogRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!isValidDateKey(input.trip_date)) {
    return { ok: false, error: "Invalid date" };
  }
  const trimmedFrom = input.from_address.trim();
  if (!trimmedFrom) return { ok: false, error: "From address is required" };
  const trimmedTo = input.to_address.trim();
  if (!trimmedTo) return { ok: false, error: "To address is required" };
  if (!isPositiveFiniteNumber(input.miles)) {
    return { ok: false, error: "Miles must be greater than 0" };
  }

  let ratePerMile: number;
  try {
    const settings = await fetchAppSettings();
    ratePerMile = Number(settings.mileage_rate_per_mile);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "App settings missing",
    };
  }

  const supabase = getSupabaseServiceClient();
  // Trust the typed miles as-is — round-trip doubling only applies to
  // Distance Matrix lookups (see acceptMileageSuggestionAction).
  const { data, error } = await supabase
    .from("mileage_logs")
    .insert({
      trip_date: input.trip_date,
      from_address: trimmedFrom,
      to_address: trimmedTo,
      miles: input.miles,
      rate_per_mile: ratePerMile,
      client_id: null,
      start_odometer: null,
      end_odometer: null,
      notes: null,
      logged_by: guard.ownerLabel,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to add mileage" };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as MileageLogRecord };
}

export type UpdateMileageLogInput = {
  trip_date?: string;
  from_address?: string;
  to_address?: string;
  miles?: number;
  notes?: string | null;
};

export async function updateMileageLogAction(
  id: string,
  updates: UpdateMileageLogInput
): Promise<ActionResult<MileageLogRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing mileage log id" };

  const patch: Record<string, unknown> = {};
  if (updates.trip_date !== undefined) {
    if (!isValidDateKey(updates.trip_date)) {
      return { ok: false, error: "Invalid date" };
    }
    patch.trip_date = updates.trip_date;
  }
  if (updates.from_address !== undefined) {
    const trimmed = updates.from_address.trim();
    if (!trimmed) return { ok: false, error: "From address cannot be empty" };
    patch.from_address = trimmed;
  }
  if (updates.to_address !== undefined) {
    const trimmed = updates.to_address.trim();
    if (!trimmed) return { ok: false, error: "To address cannot be empty" };
    patch.to_address = trimmed;
  }
  if (updates.miles !== undefined) {
    if (!isPositiveFiniteNumber(updates.miles)) {
      return { ok: false, error: "Miles must be greater than 0" };
    }
    patch.miles = updates.miles;
  }
  if (updates.notes !== undefined) {
    patch.notes = updates.notes?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No fields to update" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("mileage_logs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed" };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as MileageLogRecord };
}

export async function deleteMileageLogAction(
  id: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing mileage log id" };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("mileage_logs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner/financials");
  return { ok: true };
}

// ===========================================================================
// Suggestion accept + dismiss
// ===========================================================================

// ---------------------------------------------------------------------------
// acceptIncomeSuggestionAction
//
// Mirrors addIncomePaymentAction with two differences: writes the originating
// client_id (manual inserts pass null), and stamps source='suggested_retainer'
// so future suggestion suppression checks can match by FK instead of name.
// ---------------------------------------------------------------------------

export interface AcceptIncomeSuggestionInput {
  payment_date: string;
  client_id: string;
  client_name_snapshot: string;
  amount: number;
  income_type: IncomeType;
  payment_method?: string | null;
  notes?: string | null;
}

export async function acceptIncomeSuggestionAction(
  input: AcceptIncomeSuggestionInput
): Promise<ActionResult<IncomePaymentRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!isValidDateKey(input.payment_date)) {
    return { ok: false, error: "Invalid date" };
  }
  if (!input.client_id) {
    return { ok: false, error: "Missing client id" };
  }
  const trimmedName = input.client_name_snapshot.trim();
  if (!trimmedName) return { ok: false, error: "Client name is required" };
  if (!isPositiveFiniteNumber(input.amount)) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  if (!INCOME_TYPES.includes(input.income_type)) {
    return { ok: false, error: "Invalid income type" };
  }

  const supabase = getSupabaseServiceClient();

  // Stale-state guard: another tab may have already logged this month's
  // retainer between page load and accept. Re-run the same suppression
  // check the compute function uses (computeIncomeSuggestions:144-151).
  const incomeMonth = monthRangeForKey(input.payment_date.slice(0, 7));
  const existing = await supabase
    .from("income_payments")
    .select("id")
    .eq("client_id", input.client_id)
    .eq("income_type", "brand_retainer")
    .gte("payment_date", incomeMonth.start)
    .lte("payment_date", incomeMonth.end)
    .limit(1);
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data && existing.data.length > 0) {
    return { ok: false, error: "Already logged for this month" };
  }

  const { data, error } = await supabase
    .from("income_payments")
    .insert({
      client_id: input.client_id,
      client_name_snapshot: trimmedName,
      payment_date: input.payment_date,
      amount: input.amount,
      income_type: input.income_type,
      payment_method: input.payment_method?.trim() || null,
      notes: input.notes?.trim() || null,
      logged_by: guard.ownerLabel,
      source: "suggested_retainer",
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to accept suggestion",
    };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as IncomePaymentRecord };
}

// ---------------------------------------------------------------------------
// acceptExpenseSuggestionAction
//
// Mirrors addExpenseAction with the additional source_template_id write so
// suppression can match the new expense to the originating template.
// ---------------------------------------------------------------------------

export interface AcceptExpenseSuggestionInput {
  date: string;
  category: ExpenseCategory;
  amount: number;
  source_template_id: string;
  description?: string | null;
  notes?: string | null;
}

export async function acceptExpenseSuggestionAction(
  input: AcceptExpenseSuggestionInput
): Promise<ActionResult<ExpenseRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!isValidDateKey(input.date)) {
    return { ok: false, error: "Invalid date" };
  }
  if (!EXPENSE_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Invalid category" };
  }
  if (!isPositiveFiniteNumber(input.amount)) {
    return { ok: false, error: "Amount must be greater than 0" };
  }
  if (!input.source_template_id) {
    return { ok: false, error: "Missing template id" };
  }

  const supabase = getSupabaseServiceClient();

  // Stale-state guard: re-check FK-based suppression (the same primary
  // bucket computeExpenseSuggestions:201-202 uses) before insert.
  const expenseMonth = monthRangeForKey(input.date.slice(0, 7));
  const existing = await supabase
    .from("expenses")
    .select("id")
    .eq("source_template_id", input.source_template_id)
    .gte("date", expenseMonth.start)
    .lte("date", expenseMonth.end)
    .limit(1);
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data && existing.data.length > 0) {
    return { ok: false, error: "Already logged for this month" };
  }

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      date: input.date,
      category: input.category,
      amount: input.amount,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      source_template_id: input.source_template_id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to accept suggestion",
    };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as ExpenseRecord };
}

// ---------------------------------------------------------------------------
// acceptMileageSuggestionAction
//
// Unlike the other two accept actions, miles is COMPUTED server-side from
// the (possibly edited) from/to addresses via the Distance Matrix API.
// rate_per_mile is snapshotted from app_settings at write time, matching
// the existing addMileageLogAction shape. source_shoot_id binds the new
// log to the originating shoot for FK-based suppression on future page
// loads. The deduction column doesn't exist on mileage_logs — it's
// computed at read time as miles * rate_per_mile.
// ---------------------------------------------------------------------------

export interface AcceptMileageSuggestionInput {
  trip_date: string;
  from_address: string;
  to_address: string;
  source_shoot_id: string;
  client_id: string | null;
}

export async function acceptMileageSuggestionAction(
  input: AcceptMileageSuggestionInput
): Promise<ActionResult<MileageLogRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!isValidDateKey(input.trip_date)) {
    return { ok: false, error: "Invalid date" };
  }
  const trimmedFrom = input.from_address.trim();
  if (!trimmedFrom) return { ok: false, error: "From address is required" };
  const trimmedTo = input.to_address.trim();
  if (!trimmedTo) return { ok: false, error: "To address is required" };
  if (!input.source_shoot_id) {
    return { ok: false, error: "Missing shoot id" };
  }

  const supabase = getSupabaseServiceClient();

  // Stale-state guard: another tab may have already logged mileage for
  // this shoot. Re-check the FK suppression (computeMileageSuggestions:285)
  // before the (slow) Distance Matrix call so we fail fast.
  const existing = await supabase
    .from("mileage_logs")
    .select("id")
    .eq("source_shoot_id", input.source_shoot_id)
    .limit(1);
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data && existing.data.length > 0) {
    return { ok: false, error: "Already logged for this month" };
  }

  let ratePerMile: number;
  try {
    const settings = await fetchAppSettings();
    ratePerMile = Number(settings.mileage_rate_per_mile);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "App settings missing",
    };
  }

  let miles: number;
  try {
    miles = await getMilesBetween(trimmedFrom, trimmedTo);
  } catch (err) {
    console.error(err);
    return {
      ok: false,
      error: "Could not calculate distance — try entering miles manually.",
    };
  }
  // Distance Matrix returns one-way driving distance, but a shoot trip is
  // home → venue → home. Double it so the deduction reflects what Kelsey
  // actually drove. Re-round to one decimal to absorb any float drift
  // (`getMilesBetween` already rounds, so this is defensive — `4.4 * 2`
  // stays exact, but `Math.round(x * 10) / 10` guards against future
  // changes to the upstream rounding strategy).
  miles = Math.round(miles * 2 * 10) / 10;
  // Distance Matrix may legally return 0 for adjacent addresses; the
  // mileage_logs.miles CHECK requires > 0, and the suggestion UX really
  // wants a positive value. Surface the same fallback message.
  if (!isPositiveFiniteNumber(miles)) {
    return {
      ok: false,
      error: "Could not calculate distance — try entering miles manually.",
    };
  }

  const { data, error } = await supabase
    .from("mileage_logs")
    .insert({
      trip_date: input.trip_date,
      from_address: trimmedFrom,
      to_address: trimmedTo,
      miles,
      rate_per_mile: ratePerMile,
      client_id: input.client_id,
      start_odometer: null,
      end_odometer: null,
      notes: null,
      logged_by: guard.ownerLabel,
      source_shoot_id: input.source_shoot_id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to accept suggestion",
    };
  }
  revalidatePath("/owner/financials");
  return { ok: true, data: data as MileageLogRecord };
}

// ---------------------------------------------------------------------------
// dismissSuggestionAction
//
// Inserts a (type, reference_id, period_yyyymm) row into
// dismissed_suggestions. The table's unique constraint guarantees
// idempotency; `ignoreDuplicates: true` turns a re-dismiss into a silent
// no-op instead of a constraint-violation error.
// ---------------------------------------------------------------------------

export interface DismissSuggestionInput {
  type: SuggestionType;
  reference_id: string;
  period_yyyymm: string;
}

export async function dismissSuggestionAction(
  input: DismissSuggestionInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!SUGGESTION_TYPES.includes(input.type)) {
    return { ok: false, error: "Invalid suggestion type" };
  }
  if (!input.reference_id) {
    return { ok: false, error: "Missing reference id" };
  }
  if (!/^\d{4}-\d{2}$/.test(input.period_yyyymm)) {
    return { ok: false, error: "Invalid period" };
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("dismissed_suggestions")
    .upsert(
      {
        type: input.type,
        reference_id: input.reference_id,
        period_yyyymm: input.period_yyyymm,
      },
      {
        onConflict: "type,reference_id,period_yyyymm",
        ignoreDuplicates: true,
      }
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/owner/financials");
  return { ok: true };
}
