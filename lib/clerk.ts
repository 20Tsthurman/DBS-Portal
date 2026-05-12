import { getSupabaseServiceClient, type ClientRecord } from "@/lib/supabase";

export type LinkResult =
  | { kind: "linked"; rowId: string }
  | { kind: "already_linked"; rowId: string }
  | { kind: "no_match" }
  | { kind: "error"; message: string };

export interface LinkClerkUserToClientOpts {
  clerkUserId: string;
  clientId: string;
  emailFallback?: string;
}

// Links a Clerk user to a Supabase clients row by setting clerk_user_id.
// Idempotent: re-running with the same pair is a no-op. Never throws —
// all failures are logged and surfaced through the LinkResult union so
// the webhook handler can decide how to respond.
//
// Spec for kinds:
//   linked          — row found, clerk_user_id was NULL or different, now updated
//   already_linked  — row found, clerk_user_id already matched (idempotent retry)
//   no_match        — no row exists with the given clientId
//   error           — DB error (transient or otherwise); webhook should
//                     return 5xx so Svix retries.
export async function linkClerkUserToClient(
  opts: LinkClerkUserToClientOpts
): Promise<LinkResult> {
  const { clerkUserId, clientId, emailFallback } = opts;
  const supabase = getSupabaseServiceClient();

  const { data: lookupRow, error: lookupError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      `[clerk linker] lookup failed for clientId=${clientId} (clerkUserId=${clerkUserId}, email=${emailFallback ?? "n/a"}):`,
      lookupError.message
    );
    return { kind: "error", message: lookupError.message };
  }

  const existing = lookupRow as ClientRecord | null;
  if (!existing) {
    console.warn(
      `[clerk linker] no clients row found for clientId=${clientId} (clerkUserId=${clerkUserId}, email=${emailFallback ?? "n/a"}). Possible deletion between invite and signup.`
    );
    return { kind: "no_match" };
  }

  if (existing.clerk_user_id === clerkUserId) {
    return { kind: "already_linked", rowId: existing.id };
  }

  if (existing.clerk_user_id && existing.clerk_user_id !== clerkUserId) {
    console.warn(
      `[clerk linker] overwriting existing clerk_user_id on clients.id=${existing.id} (was=${existing.clerk_user_id}, now=${clerkUserId}). Email=${emailFallback ?? existing.email}.`
    );
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("clients")
    .update({ clerk_user_id: clerkUserId })
    .eq("id", existing.id)
    .select("id")
    .single();

  if (updateError || !updatedRow) {
    const message = updateError?.message ?? "update returned no row";
    console.error(
      `[clerk linker] update failed for clientId=${clientId} (clerkUserId=${clerkUserId}):`,
      message
    );
    return { kind: "error", message };
  }

  return { kind: "linked", rowId: existing.id };
}

export type UnlinkResult =
  | { kind: "unlinked"; rowId: string }
  | { kind: "no_match" }
  | { kind: "error"; message: string };

export interface UnlinkClerkUserOpts {
  clerkUserId: string;
}

// Clears clerk_user_id on the clients row that currently points at the
// given Clerk user. Used by the user.deleted webhook so a deleted Clerk
// user doesn't leave a dangling reference in Supabase. Idempotent.
//
// Spec for kinds:
//   unlinked   — found one row pointing at clerkUserId, set it to NULL
//   no_match   — no row referenced this user (already unlinked, or never linked)
//   error      — DB error; webhook should return 5xx so Svix retries
export async function unlinkClerkUserFromClient(
  opts: UnlinkClerkUserOpts
): Promise<UnlinkResult> {
  const { clerkUserId } = opts;
  const supabase = getSupabaseServiceClient();

  const { data: lookupRow, error: lookupError } = await supabase
    .from("clients")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      `[clerk linker] unlink lookup failed for clerkUserId=${clerkUserId}:`,
      lookupError.message
    );
    return { kind: "error", message: lookupError.message };
  }

  const existing = lookupRow as { id: string } | null;
  if (!existing) {
    return { kind: "no_match" };
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ clerk_user_id: null })
    .eq("id", existing.id);

  if (updateError) {
    console.error(
      `[clerk linker] unlink update failed for clerkUserId=${clerkUserId} (rowId=${existing.id}):`,
      updateError.message
    );
    return { kind: "error", message: updateError.message };
  }

  return { kind: "unlinked", rowId: existing.id };
}
