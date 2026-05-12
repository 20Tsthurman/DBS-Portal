"use server";

import { revalidatePath } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getSupabaseServiceClient,
  type AvailabilityBlockRecord,
} from "@/lib/supabase";

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

export interface CreateBlockInput {
  date?: string;
  recurringWeekday?: number;
  startTime?: string | null;
  endTime?: string | null;
  label?: string | null;
  /** Defaults to true (blocked time). Pass false for an "available time" window. */
  isBlocked?: boolean;
}

export interface UpdateBlockInput {
  startTime?: string | null;
  endTime?: string | null;
  label?: string | null;
  isBlocked?: boolean;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(value);
}

type TimeCheck =
  | { ok: true; start: string | null; end: string | null }
  | { ok: false; error: string };

function validateTimes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): TimeCheck {
  const startProvided =
    startTime !== null && startTime !== undefined && startTime !== "";
  const endProvided =
    endTime !== null && endTime !== undefined && endTime !== "";
  if (startProvided !== endProvided) {
    return {
      ok: false,
      error:
        "Provide both start and end times, or neither (for an all-day block).",
    };
  }
  if (!startProvided) return { ok: true, start: null, end: null };
  if (!isValidTime(startTime as string) || !isValidTime(endTime as string)) {
    return { ok: false, error: "Times must be HH:MM." };
  }
  if ((endTime as string) <= (startTime as string)) {
    return { ok: false, error: "End time must be after start time." };
  }
  return { ok: true, start: startTime as string, end: endTime as string };
}

export async function createAvailabilityBlock(
  input: CreateBlockInput
): Promise<ActionResult<AvailabilityBlockRecord>> {
  const guard = await ensureOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const hasDate =
    input.date !== undefined && input.date !== null && input.date !== "";
  const hasRecurring =
    input.recurringWeekday !== undefined && input.recurringWeekday !== null;
  if (hasDate === hasRecurring) {
    return {
      ok: false,
      error: "Provide exactly one of `date` or `recurringWeekday`.",
    };
  }

  if (hasDate && !isValidDate(input.date as string)) {
    return { ok: false, error: "`date` must be a valid YYYY-MM-DD." };
  }
  if (hasRecurring) {
    const w = input.recurringWeekday as number;
    if (!Number.isInteger(w) || w < 0 || w > 6) {
      return {
        ok: false,
        error: "`recurringWeekday` must be an integer 0–6.",
      };
    }
  }

  const timeCheck = validateTimes(input.startTime, input.endTime);
  if (!timeCheck.ok) return { ok: false, error: timeCheck.error };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("availability_blocks")
    .insert({
      date: hasDate ? (input.date as string) : null,
      recurring_weekday: hasRecurring
        ? (input.recurringWeekday as number)
        : null,
      start_time: timeCheck.start,
      end_time: timeCheck.end,
      label: input.label?.trim() || null,
      is_blocked: input.isBlocked ?? true,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to create availability block.",
    };
  }

  revalidatePath("/owner/calendar");
  return { ok: true, data: data as AvailabilityBlockRecord };
}

export async function updateAvailabilityBlock(
  blockId: string,
  updates: UpdateBlockInput
): Promise<ActionResult<AvailabilityBlockRecord>> {
  const guard = await ensureOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!blockId) return { ok: false, error: "Missing block id." };

  const patch: Record<string, unknown> = {};

  if (updates.startTime !== undefined || updates.endTime !== undefined) {
    const timeCheck = validateTimes(updates.startTime, updates.endTime);
    if (!timeCheck.ok) return { ok: false, error: timeCheck.error };
    patch.start_time = timeCheck.start;
    patch.end_time = timeCheck.end;
  }

  if (updates.label !== undefined) {
    patch.label = updates.label?.trim() || null;
  }

  if (updates.isBlocked !== undefined) {
    patch.is_blocked = updates.isBlocked;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("availability_blocks")
    .update(patch)
    .eq("id", blockId)
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to update availability block.",
    };
  }

  revalidatePath("/owner/calendar");
  return { ok: true, data: data as AvailabilityBlockRecord };
}

export async function deleteAvailabilityBlock(
  blockId: string
): Promise<ActionResult> {
  const guard = await ensureOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!blockId) return { ok: false, error: "Missing block id." };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("availability_blocks")
    .delete()
    .eq("id", blockId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/owner/calendar");
  return { ok: true };
}
