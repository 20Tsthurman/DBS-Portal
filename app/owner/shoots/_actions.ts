"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type MeetingType,
  type ShootKind,
  type ShootRecord,
  type ShootStatus,
} from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import {
  deleteGoogleEventNonFatal,
  syncShootToGoogleNonFatal,
} from "@/lib/google/push";

const VALID_STATUSES: ShootStatus[] = [
  "requested",
  "confirmed",
  "completed",
  "cancelled",
  "declined",
];

/** Cap on Kelsey's optional decline note; matches the counter in the dialog. */
const MAX_DECLINE_REASON = 500;

const VALID_KINDS: ShootKind[] = ["shoot", "meeting"];
const VALID_MEETING_TYPES: MeetingType[] = ["zoom", "phone", "in_person"];

export interface CreateShootInput {
  clientId: string;
  projectId?: string | null;
  scheduledAt: string;
  location?: string | null;
  durationHours?: number | null;
  notes?: string | null;
  status?: ShootStatus;
  /** Defaults to 'shoot' if omitted. */
  kind?: ShootKind;
  /** Required when `kind === 'meeting'`. Forced to null when kind === 'shoot'. */
  meetingType?: MeetingType | null;
}

export type UpdateShootInput = Partial<CreateShootInput>;

function isValidIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function revalidateShootPaths(clientId: string | null): void {
  revalidatePath("/owner/shoots");
  revalidatePath("/owner/calendar");
  // The client's booking page reads the same rows. It renders force-dynamic,
  // so this is belt-and-braces rather than load-bearing — but a confirm or a
  // decline is exactly the change a client must not see a stale version of.
  revalidatePath("/client/book");
  if (clientId) {
    revalidatePath(`/owner/clients/${clientId}`);
  }
}

export async function createShoot(
  input: CreateShootInput
): Promise<ActionResult<ShootRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Missing client id" };
  if (!input.scheduledAt || !isValidIso(input.scheduledAt)) {
    return { ok: false, error: "scheduled_at must be a valid ISO timestamp" };
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    return { ok: false, error: "Invalid status" };
  }
  // 'declined' is a valid status but not a creatable one. A decline is an
  // ANSWER to a client's request, so it only exists as a transition off
  // 'requested' — a shoot Kelsey books herself has no request to answer, and
  // a row created straight at 'declined' would show the client a refusal for
  // something they never asked for. declineShootRequest is the only door in.
  if (input.status === "declined") {
    return {
      ok: false,
      error:
        "A shoot can't be created as declined. Decline a client's request from the pending requests list instead.",
    };
  }

  const kind: ShootKind = input.kind ?? "shoot";
  if (!VALID_KINDS.includes(kind)) {
    return { ok: false, error: "Invalid kind" };
  }
  if (
    input.meetingType !== undefined &&
    input.meetingType !== null &&
    !VALID_MEETING_TYPES.includes(input.meetingType)
  ) {
    return { ok: false, error: "Invalid meeting type" };
  }
  // Mirror the DB constraint in the action: meetings need a type; shoots
  // never carry one (strip even if the caller sent one).
  let meetingType: MeetingType | null;
  if (kind === "meeting") {
    if (!input.meetingType) {
      return { ok: false, error: "Meeting type is required for meetings." };
    }
    meetingType = input.meetingType;
  } else {
    meetingType = null;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .insert({
      client_id: input.clientId,
      project_id: input.projectId ?? null,
      scheduled_at: input.scheduledAt,
      location: input.location?.trim() || null,
      duration_hours: input.durationHours ?? null,
      notes: input.notes?.trim() || null,
      status: input.status ?? "confirmed",
      kind,
      meeting_type: meetingType,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create shoot" };
  }

  const created = data as ShootRecord;
  // Portal → Google mirror. Non-fatal by contract: a Google hiccup marks
  // the shoot google_sync_pending and the sync sweep retries — saving in
  // the portal never fails on a push problem.
  await syncShootToGoogleNonFatal(created);
  revalidateShootPaths(created.client_id);
  return { ok: true, data: created };
}

export async function updateShoot(
  shootId: string,
  updates: UpdateShootInput
): Promise<ActionResult<ShootRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!shootId) return { ok: false, error: "Missing shoot id" };
  if (
    updates.scheduledAt !== undefined &&
    !isValidIso(updates.scheduledAt)
  ) {
    return { ok: false, error: "scheduled_at must be a valid ISO timestamp" };
  }
  if (
    updates.status !== undefined &&
    !VALID_STATUSES.includes(updates.status)
  ) {
    return { ok: false, error: "Invalid status" };
  }
  if (updates.kind !== undefined && !VALID_KINDS.includes(updates.kind)) {
    return { ok: false, error: "Invalid kind" };
  }
  if (
    updates.meetingType !== undefined &&
    updates.meetingType !== null &&
    !VALID_MEETING_TYPES.includes(updates.meetingType)
  ) {
    return { ok: false, error: "Invalid meeting type" };
  }

  const supabase = getSupabaseServiceClient();

  // Two rules need the row's CURRENT values, so fetch it once when the patch
  // touches either: the kind/meeting_type pair (a meeting must have a type, a
  // shoot must not) and the decline columns (which only 'declined' rows may
  // carry — migration 020's CHECK).
  let kindPatch: ShootKind | undefined;
  let meetingTypePatch: MeetingType | null | undefined;
  let declineFieldsPatch: Record<string, unknown> = {};
  if (
    updates.kind !== undefined ||
    updates.meetingType !== undefined ||
    updates.status !== undefined
  ) {
    const { data: current, error: lookupError } = await supabase
      .from("shoots")
      .select("kind, meeting_type, status")
      .eq("id", shootId)
      .maybeSingle();
    if (lookupError) return { ok: false, error: lookupError.message };
    if (!current) return { ok: false, error: "Shoot not found" };
    const currentRow = current as {
      kind: ShootKind;
      meeting_type: MeetingType | null;
      status: ShootStatus;
    };

    if (updates.kind !== undefined || updates.meetingType !== undefined) {
      const nextKind: ShootKind = updates.kind ?? currentRow.kind;
      const nextMeetingType: MeetingType | null =
        updates.meetingType !== undefined
          ? updates.meetingType
          : currentRow.meeting_type;

      if (nextKind === "meeting") {
        if (!nextMeetingType) {
          return { ok: false, error: "Meeting type is required for meetings." };
        }
        kindPatch = "meeting";
        meetingTypePatch = nextMeetingType;
      } else {
        kindPatch = "shoot";
        // Defense: strip meeting_type when downgrading to a shoot, even if the
        // caller didn't explicitly null it.
        meetingTypePatch = null;
      }
    }

    // Keep declined_at/decline_reason pinned to the status. Declining through
    // this generic path (the edit panel's status dropdown) stamps the time but
    // carries no note — declineShootRequest is the surface that collects one.
    //
    // Any status OTHER than 'declined' clears both columns UNCONDITIONALLY —
    // it does not first check that the row we read was 'declined'. That read
    // is a separate round trip from the write, so gating the clear on it means
    // a row that turned 'declined' in between gets a non-declined status
    // written over live decline columns: migration 020's CHECK rejects the
    // update, and the stale note would otherwise have survived. Writing the
    // nulls every time costs nothing and cannot be raced.
    if (updates.status === "declined" && currentRow.status !== "declined") {
      declineFieldsPatch = { declined_at: new Date().toISOString() };
    } else if (updates.status !== undefined && updates.status !== "declined") {
      declineFieldsPatch = { declined_at: null, decline_reason: null };
    }
  }

  const patch: Record<string, unknown> = {};
  if (updates.clientId !== undefined) patch.client_id = updates.clientId;
  if (updates.projectId !== undefined) patch.project_id = updates.projectId;
  if (updates.scheduledAt !== undefined) patch.scheduled_at = updates.scheduledAt;
  if (updates.location !== undefined) {
    patch.location = updates.location?.trim() || null;
  }
  if (updates.durationHours !== undefined) {
    patch.duration_hours = updates.durationHours;
  }
  if (updates.notes !== undefined) {
    patch.notes = updates.notes?.trim() || null;
  }
  if (updates.status !== undefined) patch.status = updates.status;
  if (kindPatch !== undefined) patch.kind = kindPatch;
  if (meetingTypePatch !== undefined) patch.meeting_type = meetingTypePatch;
  Object.assign(patch, declineFieldsPatch);

  const { data, error } = await supabase
    .from("shoots")
    .update(patch)
    .eq("id", shootId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to update shoot" };
  }

  const updated = data as ShootRecord;
  // Covers every status transition (confirm/complete → upsert in Google;
  // cancel / revert-to-requested → delete from Google). Non-fatal.
  await syncShootToGoogleNonFatal(updated);
  revalidateShootPaths(updated.client_id);
  return { ok: true, data: updated };
}

export async function confirmShoot(
  shootId: string
): Promise<ActionResult<ShootRecord>> {
  return updateShoot(shootId, { status: "confirmed" });
}

export async function cancelShoot(
  shootId: string
): Promise<ActionResult<ShootRecord>> {
  return updateShoot(shootId, { status: "cancelled" });
}

/**
 * Turn down a client's pending shoot request, with an optional note the
 * client will read.
 *
 * Separate from `cancelShoot` on purpose. Both end the shoot, but only this
 * one is an ANSWER: 'declined' is what tells the client's booking page to
 * show the request with Kelsey's reply attached instead of hiding it as a
 * self-cancellation. Routing a decline through `cancelShoot` is the bug
 * migration 020 exists to fix, so the two must not be collapsed back
 * together.
 *
 * Only a shoot still at 'requested' can be declined — declining a confirmed
 * shoot is a cancellation, and the client deserves the word that matches.
 */
export async function declineShootRequest(
  shootId: string,
  reason?: string | null
): Promise<ActionResult<ShootRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!shootId) return { ok: false, error: "Missing shoot id" };

  const trimmed = reason?.trim() || null;
  if (trimmed && trimmed.length > MAX_DECLINE_REASON) {
    return {
      ok: false,
      error: `Note is too long (${MAX_DECLINE_REASON} characters max).`,
    };
  }

  const supabase = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await supabase
    .from("shoots")
    .select("status")
    .eq("id", shootId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };
  const current = existing as Pick<ShootRecord, "status"> | null;
  if (!current) return { ok: false, error: "Shoot not found" };
  if (current.status !== "requested") {
    return {
      ok: false,
      error:
        current.status === "declined"
          ? "This request was already declined."
          : "Only a pending request can be declined.",
    };
  }

  const { data, error } = await supabase
    .from("shoots")
    .update({
      status: "declined",
      decline_reason: trimmed,
      declined_at: new Date().toISOString(),
    })
    .eq("id", shootId)
    // Re-assert the precondition in the WHERE clause so two overlapping
    // decisions can't both land — if Kelsey confirmed it in another tab
    // between the read above and this write, this matches nothing.
    .eq("status", "requested")
    .select("*")
    // maybeSingle, not single: a zero-row result here is the EXPECTED outcome
    // of losing that race, not a fault. .single() turns it into a PostgREST
    // error ("JSON object requested, multiple (or no) rows returned") that
    // would surface to Kelsey as gibberish; maybeSingle hands back data null
    // with no error, so the stale case gets its own sentence below.
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return {
      ok: false,
      error: "This request was already answered. Refresh to see where it stands.",
    };
  }

  const declined = data as ShootRecord;
  // A requested shoot was never mirrored to Google, but push anyway: the
  // rule is status-driven and this cleans up any stray event. Non-fatal.
  await syncShootToGoogleNonFatal(declined);
  revalidateShootPaths(declined.client_id);
  return { ok: true, data: declined };
}

export async function completeShoot(
  shootId: string
): Promise<ActionResult<ShootRecord>> {
  return updateShoot(shootId, { status: "completed" });
}

export async function deleteShoot(shootId: string): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!shootId) return { ok: false, error: "Missing shoot id" };

  const supabase = getSupabaseServiceClient();

  // Capture the Google linkage BEFORE the row dies — it's the only handle
  // for removing the pushed event afterward.
  const { data: existing, error: lookupError } = await supabase
    .from("shoots")
    .select("client_id, google_event_id, google_calendar_id")
    .eq("id", shootId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };

  const { error } = await supabase.from("shoots").delete().eq("id", shootId);
  if (error) return { ok: false, error: error.message };

  const row = existing as Pick<
    ShootRecord,
    "client_id" | "google_event_id" | "google_calendar_id"
  > | null;
  // Best-effort: the shoot row is gone, so a failure here has no retry
  // handle — it logs the orphaned event id for manual cleanup.
  await deleteGoogleEventNonFatal(
    row?.google_calendar_id ?? null,
    row?.google_event_id ?? null
  );

  revalidateShootPaths(row?.client_id ?? null);
  return { ok: true };
}
