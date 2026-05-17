"use server";

import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type TimeBlockCategory,
  type TimeBlockRecord,
} from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { isValidDateKey } from "@/lib/validation";
import type { ActionResult } from "@/lib/actions";

const VALID_CATEGORIES: TimeBlockCategory[] = [
  "sonography",
  "work_block",
  "blocked",
];

export interface CreateTimeBlockInput {
  /** YYYY-MM-DD wall-clock in PORTAL_TIMEZONE. */
  date: string;
  /** HH:MM wall-clock in PORTAL_TIMEZONE. */
  startTime: string;
  endTime: string;
  category: TimeBlockCategory;
  /** Only allowed when category === "work_block". */
  clientId?: string | null;
  label?: string | null;
  notes?: string | null;
}

export type UpdateTimeBlockInput = Partial<CreateTimeBlockInput>;

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(value);
}

type TimeCheck =
  | { ok: true; start: string; end: string }
  | { ok: false; error: string };

function validateTimes(
  startTime: string | undefined,
  endTime: string | undefined
): TimeCheck {
  if (!startTime || !endTime) {
    return { ok: false, error: "Start and end times are required." };
  }
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return { ok: false, error: "Times must be HH:MM." };
  }
  if (endTime <= startTime) {
    return { ok: false, error: "End time must be after start time." };
  }
  return { ok: true, start: startTime, end: endTime };
}

function validateClientId(
  category: TimeBlockCategory,
  clientId: string | null | undefined
): { ok: true } | { ok: false; error: string } {
  const hasClient = clientId !== undefined && clientId !== null && clientId !== "";
  if (hasClient && category !== "work_block") {
    return {
      ok: false,
      error: "`clientId` is only allowed when category is 'work_block'.",
    };
  }
  return { ok: true };
}

export async function createTimeBlock(
  input: CreateTimeBlockInput
): Promise<ActionResult<TimeBlockRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.date || !isValidDateKey(input.date)) {
    return { ok: false, error: "`date` must be a valid YYYY-MM-DD." };
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Invalid category." };
  }
  const timeCheck = validateTimes(input.startTime, input.endTime);
  if (!timeCheck.ok) return { ok: false, error: timeCheck.error };
  const clientCheck = validateClientId(input.category, input.clientId);
  if (!clientCheck.ok) return { ok: false, error: clientCheck.error };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("time_blocks")
    .insert({
      date: input.date,
      start_time: timeCheck.start,
      end_time: timeCheck.end,
      category: input.category,
      client_id: input.clientId || null,
      label: input.label?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to create time block.",
    };
  }

  revalidatePath("/owner/calendar");
  return { ok: true, data: data as TimeBlockRecord };
}

export async function updateTimeBlock(
  blockId: string,
  updates: UpdateTimeBlockInput
): Promise<ActionResult<TimeBlockRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!blockId) return { ok: false, error: "Missing block id." };

  const patch: Record<string, unknown> = {};

  if (updates.date !== undefined) {
    if (!isValidDateKey(updates.date)) {
      return { ok: false, error: "`date` must be a valid YYYY-MM-DD." };
    }
    patch.date = updates.date;
  }

  if (updates.startTime !== undefined || updates.endTime !== undefined) {
    const timeCheck = validateTimes(updates.startTime, updates.endTime);
    if (!timeCheck.ok) return { ok: false, error: timeCheck.error };
    patch.start_time = timeCheck.start;
    patch.end_time = timeCheck.end;
  }

  if (updates.category !== undefined) {
    if (!VALID_CATEGORIES.includes(updates.category)) {
      return { ok: false, error: "Invalid category." };
    }
    patch.category = updates.category;
  }

  // The DB enforces (category = 'work_block') OR (client_id is null), but we
  // still need to keep them coherent here: if the caller flips category to
  // non-work and didn't also clear client_id, error out so we surface the
  // mistake instead of hitting a constraint violation.
  if (updates.clientId !== undefined || updates.category !== undefined) {
    const effectiveCategory =
      (updates.category as TimeBlockCategory | undefined) ??
      (patch.category as TimeBlockCategory | undefined);
    if (effectiveCategory !== undefined) {
      const clientCheck = validateClientId(effectiveCategory, updates.clientId);
      if (!clientCheck.ok) return { ok: false, error: clientCheck.error };
    }
    if (updates.clientId !== undefined) {
      patch.client_id = updates.clientId || null;
    }
  }

  if (updates.label !== undefined) {
    patch.label = updates.label?.trim() || null;
  }
  if (updates.notes !== undefined) {
    patch.notes = updates.notes?.trim() || null;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("time_blocks")
    .update(patch)
    .eq("id", blockId)
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to update time block.",
    };
  }

  revalidatePath("/owner/calendar");
  return { ok: true, data: data as TimeBlockRecord };
}

export async function deleteTimeBlock(
  blockId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!blockId) return { ok: false, error: "Missing block id." };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("time_blocks")
    .delete()
    .eq("id", blockId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/owner/calendar");
  return { ok: true };
}
