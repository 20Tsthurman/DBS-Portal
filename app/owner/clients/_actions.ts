"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ClientStatus,
  type ClientType,
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

const VALID_CLIENT_TYPES: ClientType[] = ["brand", "bride"];
const VALID_CLIENT_STATUSES: ClientStatus[] = [
  "active",
  "onboarding",
  "inactive",
  "lead",
];

export interface CreateDraftClientInput {
  name: string;
  email: string;
  type: ClientType;
  packageId: string | null;
  status: ClientStatus;
}

// ---------------------------------------------------------------------------
// createDraftClientAction
//
// Inserts a clients row WITHOUT sending a Clerk invitation or Resend email.
// `invited_at` and `clerk_user_id` both stay NULL — the row is a "draft
// client" with no portal access until the owner later sends the invite from
// the profile page (which routes through /api/invite, whose existing
// "reuse unlinked row by email" branch — see app/api/invite/route.ts:299-303
// — picks this row up automatically and stamps invited_at at that point).
//
// Mirrors the column names and defaults used by /api/invite's insert path
// (app/api/invite/route.ts:341-441) so the two creation paths stay schema-
// compatible: same trim/normalize for name+email, same projects defaults
// (current_phase='onboarding', status='active'), same rollback-on-failure
// for the brand-new clients row if the projects insert errors.
// ---------------------------------------------------------------------------
export async function createDraftClientAction(
  input: CreateDraftClientInput
): Promise<ActionResult<ClientRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!email || !email.includes("@")) {
    return { ok: false, error: "A valid email address is required" };
  }
  const normalizedEmail = email.toLowerCase();

  if (!VALID_CLIENT_TYPES.includes(input.type)) {
    return { ok: false, error: "type must be 'brand' or 'bride'" };
  }
  if (!VALID_CLIENT_STATUSES.includes(input.status)) {
    return {
      ok: false,
      error: "status must be active, onboarding, inactive, or lead",
    };
  }
  if (
    input.packageId !== null &&
    input.packageId !== undefined &&
    typeof input.packageId !== "string"
  ) {
    return { ok: false, error: "packageId must be a string or null" };
  }

  const supabase = getSupabaseServiceClient();

  const { data: insertedRow, error: insertError } = await supabase
    .from("clients")
    .insert({
      name,
      email: normalizedEmail,
      type: input.type,
      status: input.status,
      clerk_user_id: null,
      invited_at: null,
    })
    .select("*")
    .single();

  if (insertError || !insertedRow) {
    if (insertError?.code === "23505") {
      return { ok: false, error: "A client with this email already exists." };
    }
    return {
      ok: false,
      error: insertError?.message ?? "Failed to create client",
    };
  }
  const client = insertedRow as ClientRecord;

  if (typeof input.packageId === "string" && input.packageId.length > 0) {
    const { error: projectError } = await supabase.from("projects").insert({
      client_id: client.id,
      package_id: input.packageId,
      current_phase: "onboarding",
      status: "active",
    });
    if (projectError) {
      // Roll back the just-inserted clients row so a retry is clean.
      // Mirrors the invite route's brand-new-row rollback (route.ts:404-415).
      const { error: rollbackErr } = await supabase
        .from("clients")
        .delete()
        .eq("id", client.id);
      if (rollbackErr) {
        console.error(
          `[clients] draft project insert failed AND rollback failed for clients.id=${client.id}:`,
          rollbackErr.message
        );
      }
      return {
        ok: false,
        error: `Could not link package: ${projectError.message}. Please try again.`,
      };
    }
  }

  revalidatePath("/owner/clients");
  return { ok: true, data: client };
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
