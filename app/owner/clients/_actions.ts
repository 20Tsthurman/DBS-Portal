"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
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
import { resolveBaseUrl } from "@/lib/baseUrl";
import { normalizePhone } from "@/lib/phone";
import type { ActionResult } from "@/lib/actions";

async function forwardCookieHeader(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

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

export interface CreateClientInput {
  name: string;
  /** Optional since migration 004 — at least one of email/phone is required. */
  email: string | null;
  /** Optional. Any format accepted; normalized to a bare 10-digit string. */
  phone: string | null;
  type: ClientType;
  packageId: string | null;
  status: ClientStatus;
  /**
   * When true, route through /api/invite (Clerk invitation + Resend email)
   * and stamp invited_at. When false, insert a "draft client" row with
   * clerk_user_id and invited_at left NULL — Kelsey can send the invite
   * later from the client detail page.
   */
  sendInvite: boolean;
}

// ---------------------------------------------------------------------------
// createClientAction
//
// Single entry point for the Add Client form. Branches on `sendInvite`:
//
// sendInvite=false → inserts a clients row WITHOUT a Clerk invitation or
//   Resend email. `invited_at` and `clerk_user_id` stay NULL. The row picks
//   up its portal access later when Kelsey clicks "Send Invite" on the
//   client detail page, which routes through /api/invite's "reuse unlinked
//   row by email" branch (app/api/invite/route.ts:299-303).
//
// sendInvite=true → delegates to /api/invite which handles the Clerk-create
//   + Resend-send + invited_at-stamp work end-to-end (it also does its own
//   clients/projects insert with status='onboarding'). Cookies are forwarded
//   so the route's auth() picks up Kelsey server-side. Mirrors the pattern
//   in `sendInviteAction` below; see that function's FOLLOW-UP comment for
//   the shared-helper extraction this whole branch is waiting on.
//
// The draft-insert path mirrors the column names and defaults used by
// /api/invite's insert path (app/api/invite/route.ts:341-441) so the two
// creation paths stay schema-compatible: same trim/normalize for name+email,
// same projects defaults (current_phase='onboarding', status='active'),
// same rollback-on-failure for the brand-new clients row if the projects
// insert errors.
// ---------------------------------------------------------------------------
export async function createClientAction(
  input: CreateClientInput
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  // Email is optional, but must be a valid address when present.
  const email = typeof input.email === "string" ? input.email.trim() : "";
  let normalizedEmail: string | null = null;
  if (email) {
    if (!email.includes("@")) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    normalizedEmail = email.toLowerCase();
  }

  // Phone is optional; normalize to the canonical 10-digit form when present.
  const phoneResult = normalizePhone(input.phone);
  if (!phoneResult.ok) {
    return { ok: false, error: "Please enter a valid 10-digit phone number." };
  }
  const phone = phoneResult.value;

  // At least one contact method (enforced here, not at the DB layer).
  if (!normalizedEmail && !phone) {
    return {
      ok: false,
      error: "Please provide either an email address or a phone number.",
    };
  }

  // The invite path (Clerk + Resend) is keyed on an email address.
  if (input.sendInvite && !normalizedEmail) {
    return {
      ok: false,
      error: "An email address is required to send a portal invite.",
    };
  }

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

  if (input.sendInvite) {
    const cookieHeader = await forwardCookieHeader();
    const inviteRes = await fetch(`${resolveBaseUrl()}/api/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        name,
        email: normalizedEmail,
        type: input.type,
        packageId: input.packageId,
      }),
      cache: "no-store",
    });

    const inviteData = (await inviteRes.json().catch(() => ({}))) as {
      client?: { id: string };
      error?: string;
      warning?: string;
    };

    // 207 = invite succeeded but Resend email failed; the row exists and
    // invited_at was stamped, so we treat it as success for the form.
    if (!inviteRes.ok && inviteRes.status !== 207) {
      return { ok: false, error: inviteData.error ?? "Failed to create client." };
    }
    const newId = inviteData.client?.id;
    if (!newId) {
      return { ok: false, error: "Invite succeeded but no client id returned." };
    }

    // /api/invite owns the row insert and has no phone column in its body, so
    // stamp the phone here once the row exists. Best-effort: the invite already
    // succeeded (invited_at stamped), so a phone-write hiccup shouldn't fail
    // the form — log and continue.
    if (phone) {
      const supabase = getSupabaseServiceClient();
      const { error: phoneError } = await supabase
        .from("clients")
        .update({ phone })
        .eq("id", newId);
      if (phoneError) {
        console.error(
          `[clients] invite succeeded but phone update failed for clients.id=${newId}:`,
          phoneError.message
        );
      }
    }

    revalidatePath("/owner/clients");
    return { ok: true, data: { id: newId } };
  }

  const supabase = getSupabaseServiceClient();

  const { data: insertedRow, error: insertError } = await supabase
    .from("clients")
    .insert({
      name,
      email: normalizedEmail,
      phone,
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
  return { ok: true, data: { id: client.id } };
}

// ---------------------------------------------------------------------------
// updateProjectPricingAction
//
// Persists per-client price/hours overrides onto the client's most recent
// projects row. NULL = inherit the package default. Mirrors the lookup
// pattern in `updateNotesAction` above (same most-recent-by-start_date pick).
// If the client has no projects row yet, one is inserted with the same
// onboarding defaults the invite path uses (current_phase='onboarding',
// status='active', no package_id) so the overrides land somewhere.
//
// The clients PATCH route (app/api/clients/[id]/route.ts) intentionally
// stays scoped to the clients table — projects writes route through here.
// ---------------------------------------------------------------------------
export interface UpdateProjectPricingInput {
  clientId: string;
  monthlyPriceOverride: number | null;
  monthlyHoursOverride: number | null;
}

export async function updateProjectPricingAction(
  input: UpdateProjectPricingInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.clientId) return { ok: false, error: "Missing client id" };

  if (input.monthlyPriceOverride !== null) {
    if (
      !Number.isFinite(input.monthlyPriceOverride) ||
      input.monthlyPriceOverride < 0
    ) {
      return {
        ok: false,
        error: "Monthly price override must be a non-negative number",
      };
    }
  }
  if (input.monthlyHoursOverride !== null) {
    if (
      !Number.isFinite(input.monthlyHoursOverride) ||
      input.monthlyHoursOverride < 0
    ) {
      return {
        ok: false,
        error: "Monthly hours override must be a non-negative number",
      };
    }
  }

  const supabase = getSupabaseServiceClient();

  const { data: existingRow, error: lookupError } = await supabase
    .from("projects")
    .select("*")
    .eq("client_id", input.clientId)
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };

  if (!existingRow) {
    const { error: insertError } = await supabase.from("projects").insert({
      client_id: input.clientId,
      current_phase: "onboarding",
      status: "active",
      monthly_price_override: input.monthlyPriceOverride,
      monthly_hours_override: input.monthlyHoursOverride,
    });
    if (insertError) return { ok: false, error: insertError.message };
  } else {
    const project = existingRow as ProjectRecord;
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        monthly_price_override: input.monthlyPriceOverride,
        monthly_hours_override: input.monthlyHoursOverride,
      })
      .eq("id", project.id);
    if (updateError) return { ok: false, error: updateError.message };
  }

  revalidatePath(`/owner/clients/${input.clientId}`);
  revalidatePath("/owner/clients");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// sendInviteAction
//
// Triggers an invite for an existing clients row from the profile page. Used
// by the "Send Invite" / "Resend Invite" button to invite a draft client or
// re-invite one whose link expired.
//
// Delegates to POST /api/invite (which exists for Add Client form). That route's
// "reuse existing unlinked row by email" branch (app/api/invite/route.ts:299-303)
// finds this exact row by email and handles the Clerk + Resend + invited_at
// stamping path identically to a fresh invite. Forwards the owner's session
// cookies so the route's auth() picks up Kelsey's identity server-side.
//
// FOLLOW-UP (not this PR): the Clerk-create + Resend-send + invited_at-stamp
// block in /api/invite (~lines 443-575) is a clean candidate to extract to a
// shared `lib/inviteClient.ts` so both this action and the route call into it
// without the HTTP round-trip. ~200 lines; deserves its own change.
// ---------------------------------------------------------------------------
export interface SendInviteInput {
  clientId: string;
}

export async function sendInviteAction(
  input: SendInviteInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.clientId) return { ok: false, error: "Missing client id" };

  const supabase = getSupabaseServiceClient();
  const { data: clientRow, error: lookupError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", input.clientId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };
  const client = clientRow as ClientRecord | null;
  if (!client) return { ok: false, error: "Client not found" };

  if (client.type === "bride") {
    return { ok: false, error: "Bride portal is not yet available." };
  }
  if (client.status === "inactive") {
    return { ok: false, error: "Cannot invite an inactive client." };
  }

  // Recover packageId from the existing project so /api/invite's package-sync
  // branch leaves the row in a consistent state (no-op since the package_id
  // already matches).
  const { data: projectRow } = await supabase
    .from("projects")
    .select("package_id")
    .eq("client_id", client.id)
    .maybeSingle();
  const packageId =
    (projectRow as { package_id: string | null } | null)?.package_id ?? null;

  const cookieHeader = await forwardCookieHeader();

  const inviteRes = await fetch(`${resolveBaseUrl()}/api/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      name: client.name,
      email: client.email,
      type: client.type,
      packageId,
    }),
    cache: "no-store",
  });

  const inviteData = (await inviteRes.json().catch(() => ({}))) as {
    error?: string;
    warning?: string;
  };

  // 207 = invite succeeded but Resend email failed; treat as success for the
  // button (the route already stamped invited_at and the Clerk URL exists).
  if (!inviteRes.ok && inviteRes.status !== 207) {
    return { ok: false, error: inviteData.error ?? "Could not send invite." };
  }

  revalidatePath(`/owner/clients/${client.id}`);
  revalidatePath("/owner/clients");
  return { ok: true };
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
