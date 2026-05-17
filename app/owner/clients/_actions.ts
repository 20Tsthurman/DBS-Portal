"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ProjectRecord,
  type TimeLogCategory,
  type TimeLogRecord,
} from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { tryBanClerkUser } from "@/lib/clerk";
import type { ActionResult } from "@/lib/actions";

const VALID_CATEGORIES: TimeLogCategory[] = [
  "editing",
  "planning",
  "filming",
  "admin",
  "communication",
];

export interface AddTimeLogInput {
  clientId: string;
  date: string;
  hours: number;
  category: TimeLogCategory;
  notes: string;
}

export async function addTimeLogAction(
  input: AddTimeLogInput
): Promise<ActionResult<TimeLogRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Missing client id" };
  if (!input.date) return { ok: false, error: "Date is required" };
  if (!Number.isFinite(input.hours) || input.hours <= 0) {
    return { ok: false, error: "Hours must be greater than 0" };
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Invalid category" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("time_logs")
    .insert({
      client_id: input.clientId,
      logged_by: guard.ownerLabel,
      date: input.date,
      hours: input.hours,
      category: input.category,
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to log time" };
  }

  revalidatePath(`/owner/clients/${input.clientId}`);
  revalidatePath("/owner/clients");
  return { ok: true, data: data as TimeLogRecord };
}

export async function deleteTimeLogAction(
  logId: string,
  clientId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("time_logs").delete().eq("id", logId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/owner/clients/${clientId}`);
  revalidatePath("/owner/clients");
  return { ok: true };
}

export interface UpdateNotesInput {
  clientId: string;
  notes: string;
}

export async function updateNotesAction(
  input: UpdateNotesInput
): Promise<ActionResult<{ savedAt: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = getSupabaseServiceClient();

  const { data: existingRow, error: lookupError } = await supabase
    .from("projects")
    .select("*")
    .eq("client_id", input.clientId)
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };

  const trimmed = input.notes.length > 0 ? input.notes : null;

  if (!existingRow) {
    const { error: insertError } = await supabase.from("projects").insert({
      client_id: input.clientId,
      current_phase: "onboarding",
      status: "active",
      notes: trimmed,
    });
    if (insertError) return { ok: false, error: insertError.message };
  } else {
    const project = existingRow as ProjectRecord;
    const { error: updateError } = await supabase
      .from("projects")
      .update({ notes: trimmed })
      .eq("id", project.id);
    if (updateError) return { ok: false, error: updateError.message };
  }

  revalidatePath(`/owner/clients/${input.clientId}`);
  return { ok: true, data: { savedAt: new Date().toISOString() } };
}

// ---------------------------------------------------------------------------
// deactivateClientAction
//
// Soft-delete: flips clients.status to 'inactive' and best-effort bans the
// Clerk user so they can't create new sessions. Mirrors the behavior of
// `DELETE /api/clients/[id]` (app/api/clients/[id]/route.ts:175-211) — both
// paths exist because the API route is what `EditClientButton`'s legacy
// flow targets, and this server action is what the new "Deactivate Client"
// button on the detail page targets. The shared ban helper lives in
// lib/clerk.ts; never duplicate it inline.
//
// NEVER convert this to a SQL DELETE — see the NEVER-HARD-DELETE comment
// at the top of `clients` in supabase/schema.sql.
// ---------------------------------------------------------------------------
export async function deactivateClientAction(
  id: string
): Promise<ActionResult<null>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing client id" };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ status: "inactive" })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to deactivate client",
    };
  }

  const deactivated = data as ClientRecord;
  if (deactivated.clerk_user_id) {
    await tryBanClerkUser(deactivated.clerk_user_id);
    console.log(
      `[clients] deactivated row=${deactivated.id} banned=${deactivated.clerk_user_id}`
    );
  }

  revalidatePath("/owner/clients");
  revalidatePath(`/owner/clients/${id}`);
  return { ok: true };
}
