"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type ShootRecord,
} from "@/lib/supabase";
import { requireCurrentClient } from "@/lib/currentClient";
import {
  combineDateAndTimeInTimezone,
  dateKeyInTimezone,
} from "@/app/owner/calendar/_lib/timezone";
import { checkBookingConflicts } from "./_lib/conflicts";

export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface RequestShootInput {
  /** YYYY-MM-DD in PORTAL_TIMEZONE. */
  date: string;
  /** HH:MM in PORTAL_TIMEZONE. Must be within 07:00–21:00. */
  startTime: string;
  /** Hours. Must be 0.5–12. */
  durationHours: number;
  location?: string | null;
  notes?: string | null;
  /**
   * When true, skip the conflict check and write directly. Used after the
   * client confirms the "Kelsey has a possible conflict — send anyway?"
   * prompt.
   */
  acknowledgeConflict?: boolean;
}

export type RequestShootResult =
  | { ok: true; shootId: string }
  | { ok: false; error: "auth"; message: string }
  | { ok: false; error: "validation"; message: string }
  | { ok: false; error: "conflict"; conflictCount: number }
  | { ok: false; error: "internal"; message: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const WORK_DAY_START_MIN = 7 * 60;
const WORK_DAY_END_MIN = 21 * 60;

function parseDateKey(s: string): { y: number; m: number; d: number } | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  // Round-trip via UTC to reject things like 2026-02-30.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

function parseTimeOfDay(s: string): number | null {
  if (!TIME_RE.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export async function requestShoot(
  input: RequestShootInput
): Promise<RequestShootResult> {
  let clientId: string;
  try {
    const client = await requireCurrentClient();
    clientId = client.id;
  } catch {
    return { ok: false, error: "auth", message: "Not authenticated." };
  }

  if (!parseDateKey(input.date)) {
    return { ok: false, error: "validation", message: "Invalid date." };
  }

  const startMin = parseTimeOfDay(input.startTime);
  if (startMin === null) {
    return { ok: false, error: "validation", message: "Invalid start time." };
  }

  const duration = Number(input.durationHours);
  if (!Number.isFinite(duration) || duration < 0.5 || duration > 12) {
    return {
      ok: false,
      error: "validation",
      message: "Duration must be between 0.5 and 12 hours.",
    };
  }

  if (startMin < WORK_DAY_START_MIN) {
    return {
      ok: false,
      error: "validation",
      message: "Start time must be 7 AM or later.",
    };
  }
  if (startMin >= WORK_DAY_END_MIN) {
    return {
      ok: false,
      error: "validation",
      message: "Start time must be before 9 PM.",
    };
  }

  const endMin = startMin + duration * 60;
  if (endMin > WORK_DAY_END_MIN) {
    return {
      ok: false,
      error: "validation",
      message: "Shoot must end by 9 PM.",
    };
  }

  const todayKey = dateKeyInTimezone(new Date());
  if (input.date < todayKey) {
    return { ok: false, error: "validation", message: "Date is in the past." };
  }

  const startsAt = combineDateAndTimeInTimezone(input.date, input.startTime);
  const endsAt = new Date(startsAt.getTime() + duration * 60 * 60 * 1000);

  if (!input.acknowledgeConflict) {
    const { count } = await checkBookingConflicts(startsAt, endsAt);
    if (count > 0) {
      return { ok: false, error: "conflict", conflictCount: count };
    }
  }

  const location = input.location?.trim() || null;
  const notes = input.notes?.trim() || null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .insert({
      client_id: clientId,
      project_id: null,
      scheduled_at: startsAt.toISOString(),
      duration_hours: duration,
      location,
      notes,
      status: "requested",
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: "internal",
      message: error?.message ?? "Failed to create shoot.",
    };
  }

  revalidatePath("/client/book");
  revalidatePath("/owner/calendar");

  return { ok: true, shootId: (data as { id: string }).id };
}

function revalidateBookingPaths(clientId: string): void {
  revalidatePath("/client/book");
  revalidatePath("/owner/shoots");
  revalidatePath("/owner/calendar");
  revalidatePath(`/owner/clients/${clientId}`);
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
