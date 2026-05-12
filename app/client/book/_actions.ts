"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type ShootRecord,
} from "@/lib/supabase";
import { requireCurrentClient } from "@/lib/currentClient";

export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "specific";

export interface RequestShootInput {
  scheduledAt: string;
  timeOfDay: TimeOfDay;
  location?: string | null;
  notes?: string | null;
}

const VALID_TIMES_OF_DAY: TimeOfDay[] = [
  "morning",
  "afternoon",
  "evening",
  "specific",
];

function isValidIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// Time-of-day is captured in `shoots.notes` rather than a dedicated column:
// it's UI metadata only, Kelsey reads it inline when reviewing requests, and
// a schema change for one free-text field isn't worth it.
function buildNotes(
  timeOfDay: TimeOfDay,
  rawNotes: string | null | undefined
): string | null {
  const userNotes = rawNotes?.trim() ?? "";
  if (timeOfDay === "specific") {
    return userNotes.length > 0 ? userNotes : null;
  }
  const prefix = `Time preference: ${capitalize(timeOfDay)}`;
  return userNotes.length > 0 ? `${prefix}\n\n${userNotes}` : prefix;
}

function revalidateBookingPaths(clientId: string): void {
  revalidatePath("/client/book");
  revalidatePath("/owner/shoots");
  revalidatePath("/owner/calendar");
  revalidatePath(`/owner/clients/${clientId}`);
}

export async function requestShoot(
  input: RequestShootInput
): Promise<ActionResult<ShootRecord>> {
  let clientId: string;
  try {
    const client = await requireCurrentClient();
    clientId = client.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  if (!input.scheduledAt || !isValidIso(input.scheduledAt)) {
    return { ok: false, error: "scheduled_at must be a valid ISO timestamp" };
  }
  if (new Date(input.scheduledAt) <= new Date()) {
    return { ok: false, error: "Cannot request a shoot in the past" };
  }
  if (!VALID_TIMES_OF_DAY.includes(input.timeOfDay)) {
    return { ok: false, error: "Invalid time-of-day preference" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .insert({
      client_id: clientId,
      project_id: null,
      scheduled_at: input.scheduledAt,
      location: input.location?.trim() || null,
      duration_hours: null,
      notes: buildNotes(input.timeOfDay, input.notes),
      status: "requested",
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to request shoot" };
  }

  const created = data as ShootRecord;
  revalidateBookingPaths(clientId);
  return { ok: true, data: created };
}

export async function cancelMyShootRequest(
  shootId: string
): Promise<ActionResult> {
  let clientId: string;
  try {
    const client = await requireCurrentClient();
    clientId = client.id;
  } catch {
    return { ok: false, error: "Unauthorized" };
  }

  if (!shootId) return { ok: false, error: "Missing shoot id" };

  const supabase = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await supabase
    .from("shoots")
    .select("*")
    .eq("id", shootId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };

  const shoot = existing as ShootRecord | null;
  if (!shoot) return { ok: false, error: "Shoot not found" };
  if (shoot.client_id !== clientId) {
    return { ok: false, error: "Not your shoot" };
  }
  if (shoot.status !== "requested") {
    return {
      ok: false,
      error:
        "Only pending requests can be cancelled from here. Contact Kelsey to cancel a confirmed shoot.",
    };
  }

  const { error: updateError } = await supabase
    .from("shoots")
    .update({ status: "cancelled" })
    .eq("id", shootId);

  if (updateError) return { ok: false, error: updateError.message };

  revalidateBookingPaths(clientId);
  return { ok: true, data: null };
}
