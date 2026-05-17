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

const VALID_STATUSES: ShootStatus[] = [
  "requested",
  "confirmed",
  "completed",
  "cancelled",
];

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

  // When either kind or meetingType is in the patch we need to re-validate
  // the pair (a meeting must have a type, a shoot must not). Easiest is to
  // fetch the current row, merge updates, then validate the resulting pair.
  let kindPatch: ShootKind | undefined;
  let meetingTypePatch: MeetingType | null | undefined;
  if (updates.kind !== undefined || updates.meetingType !== undefined) {
    const { data: current, error: lookupError } = await supabase
      .from("shoots")
      .select("kind, meeting_type")
      .eq("id", shootId)
      .maybeSingle();
    if (lookupError) return { ok: false, error: lookupError.message };
    if (!current) return { ok: false, error: "Shoot not found" };
    const currentRow = current as { kind: ShootKind; meeting_type: MeetingType | null };

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

  const { data: existing, error: lookupError } = await supabase
    .from("shoots")
    .select("client_id")
    .eq("id", shootId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };

  const { error } = await supabase.from("shoots").delete().eq("id", shootId);
  if (error) return { ok: false, error: error.message };

  const clientId =
    (existing as { client_id: string } | null)?.client_id ?? null;
  revalidateShootPaths(clientId);
  return { ok: true };
}
