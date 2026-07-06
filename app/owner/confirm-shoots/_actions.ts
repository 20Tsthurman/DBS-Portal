"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import {
  getSupabaseServiceClient,
  type ExternalEventRecord,
} from "@/lib/supabase";
import {
  combineDateAndTimeInTimezone,
  dateKeyInTimezone,
} from "@/app/owner/calendar/_lib/timezone";
import { createShoot } from "@/app/owner/shoots/_actions";

const TIME_RE = /^\d{2}:\d{2}$/;
const HOUR_MS = 60 * 60 * 1000;

export interface ConfirmShootCandidateInput {
  externalEventId: string;
  clientId: string;
  /** The (possibly edited) location text. Empty/whitespace → shoot with no location. */
  location: string | null;
  /**
   * HH:MM wall-clock start in PORTAL_TIMEZONE — only used for all-day
   * candidates, which have no meaningful time of their own. Defaults 09:00
   * (the portal's default-shoot-time convention). Ignored for timed events.
   */
  startTime?: string;
}

// ---------------------------------------------------------------------------
// confirmShootCandidateAction
//
// Converts a pending candidate into a real shoot via the EXISTING createShoot
// action — same validation, same revalidation, and the shoot then feeds the
// existing mileage-suggestion pipeline once its date passes (nothing
// mileage-specific happens here, by design).
//
// Ordering: the candidate is CLAIMED first (pending → confirmed, guarded by
// eq shoot_candidate='pending' so a double-submit can't create two shoots),
// then the shoot is created, then converted_shoot_id is stamped. If shoot
// creation fails the claim is reverted so the row returns to the queue.
// ---------------------------------------------------------------------------
export async function confirmShootCandidateAction(
  input: ConfirmShootCandidateInput
): Promise<ActionResult<{ shootId: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.externalEventId) return { ok: false, error: "Missing event id" };
  if (!input.clientId) return { ok: false, error: "Client is required" };
  if (input.startTime !== undefined && !isValidTime(input.startTime)) {
    return { ok: false, error: "Invalid start time" };
  }

  const supabase = getSupabaseServiceClient();
  const { data: rowData, error: lookupError } = await supabase
    .from("external_events")
    .select("*")
    .eq("id", input.externalEventId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };

  const row = rowData as ExternalEventRecord | null;
  if (!row) return { ok: false, error: "Event not found" };
  if (row.status !== "confirmed" || row.shoot_candidate !== "pending") {
    return { ok: false, error: "This event is no longer pending" };
  }

  // Claim before creating — the eq('pending') filter makes a concurrent
  // double-confirm affect zero rows instead of creating a second shoot.
  const claim = await supabase
    .from("external_events")
    .update({ shoot_candidate: "confirmed" })
    .eq("id", row.id)
    .eq("shoot_candidate", "pending")
    .select("id");
  if (claim.error) return { ok: false, error: claim.error.message };
  if ((claim.data ?? []).length === 0) {
    return { ok: false, error: "This event was already handled" };
  }

  let scheduledAt: string;
  let durationHours: number | null;
  if (row.all_day) {
    // starts_at is a PORTAL_TIMEZONE midnight; re-anchor to the chosen
    // wall-clock time on that same Central day.
    const dateKey = dateKeyInTimezone(new Date(row.starts_at));
    const time = input.startTime ?? "09:00";
    scheduledAt = combineDateAndTimeInTimezone(dateKey, time).toISOString();
    durationHours = null;
  } else {
    scheduledAt = new Date(row.starts_at).toISOString();
    const spanMs =
      new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime();
    durationHours =
      spanMs > 0 ? Math.round((spanMs / HOUR_MS) * 100) / 100 : null;
  }

  const created = await createShoot({
    clientId: input.clientId,
    scheduledAt,
    location: input.location?.trim() || null,
    durationHours,
    notes: null,
    status: "confirmed",
    kind: "shoot",
  });

  if (!created.ok || !created.data) {
    // Return the row to the queue — the shoot never materialized.
    await supabase
      .from("external_events")
      .update({ shoot_candidate: "pending" })
      .eq("id", row.id);
    return { ok: false, error: created.error ?? "Failed to create shoot" };
  }

  const { error: stampError } = await supabase
    .from("external_events")
    .update({ converted_shoot_id: created.data.id })
    .eq("id", row.id);
  if (stampError) {
    // Shoot exists; the event stays hidden from the queue ('confirmed') but
    // keeps rendering until converted_shoot_id lands. Surface the error —
    // re-confirming is blocked, so this needs eyes rather than silence.
    return {
      ok: false,
      error: `Shoot created, but linking failed: ${stampError.message}`,
    };
  }

  revalidatePath("/owner/confirm-shoots");
  revalidatePath("/owner/calendar");
  return { ok: true, data: { shootId: created.data.id } };
}

// ---------------------------------------------------------------------------
// dismissShootCandidateAction — "not a shoot". The row reverts to a plain
// busy event and, because sync only flags NULL rows, never re-prompts.
// ---------------------------------------------------------------------------
export async function dismissShootCandidateAction(
  externalEventId: string
): Promise<ActionResult<null>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!externalEventId) return { ok: false, error: "Missing event id" };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("external_events")
    .update({ shoot_candidate: "dismissed" })
    .eq("id", externalEventId)
    .eq("shoot_candidate", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if ((data ?? []).length === 0) {
    return { ok: false, error: "This event was already handled" };
  }

  revalidatePath("/owner/confirm-shoots");
  return { ok: true };
}

function isValidTime(s: string): boolean {
  if (!TIME_RE.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
