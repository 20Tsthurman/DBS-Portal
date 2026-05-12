"use server";

import { revalidatePath } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getSupabaseServiceClient,
  type ShootRecord,
  type ShootStatus,
} from "@/lib/supabase";

const VALID_STATUSES: ShootStatus[] = [
  "requested",
  "confirmed",
  "completed",
  "cancelled",
];

async function ensureOwner(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized" };
  const user = await currentUser();
  if (user?.publicMetadata?.role !== "owner") {
    return { ok: false, error: "Forbidden" };
  }
  return { ok: true };
}

export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface CreateShootInput {
  clientId: string;
  projectId?: string | null;
  scheduledAt: string;
  location?: string | null;
  durationHours?: number | null;
  notes?: string | null;
  status?: ShootStatus;
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
  const guard = await ensureOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Missing client id" };
  if (!input.scheduledAt || !isValidIso(input.scheduledAt)) {
    return { ok: false, error: "scheduled_at must be a valid ISO timestamp" };
  }
  if (input.status && !VALID_STATUSES.includes(input.status)) {
    return { ok: false, error: "Invalid status" };
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
  const guard = await ensureOwner();
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

  const supabase = getSupabaseServiceClient();
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
  const guard = await ensureOwner();
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
