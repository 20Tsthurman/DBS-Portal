import {
  getSupabaseServiceClient,
  type AvailabilityBlockRecord,
} from "@/lib/supabase";
import { dateKey } from "./dateMath";

/**
 * Fetch all availability_blocks relevant to the given date range:
 *   - One-off blocks whose `date` falls in [start, end)
 *   - Every recurring block (recurring_weekday IS NOT NULL), regardless of range —
 *     callers expand them to specific dates per week via `blocksForDate`.
 */
export async function fetchAvailabilityBlocksInRange(
  start: Date,
  end: Date
): Promise<AvailabilityBlockRecord[]> {
  const supabase = getSupabaseServiceClient();
  const [oneOffsRes, recurringRes] = await Promise.all([
    supabase
      .from("availability_blocks")
      .select("*")
      .gte("date", dateKey(start))
      .lt("date", dateKey(end)),
    supabase
      .from("availability_blocks")
      .select("*")
      .not("recurring_weekday", "is", null),
  ]);
  if (oneOffsRes.error) throw new Error(oneOffsRes.error.message);
  if (recurringRes.error) throw new Error(recurringRes.error.message);

  return [
    ...((oneOffsRes.data ?? []) as AvailabilityBlockRecord[]),
    ...((recurringRes.data ?? []) as AvailabilityBlockRecord[]),
  ];
}

/** Fetch every recurring availability block (recurring_weekday IS NOT NULL). */
export async function fetchRecurringAvailabilityBlocks(): Promise<
  AvailabilityBlockRecord[]
> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("availability_blocks")
    .select("*")
    .not("recurring_weekday", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as AvailabilityBlockRecord[];
}

/**
 * Given an array of blocks (one-off + recurring, as returned by
 * fetchAvailabilityBlocksInRange) and a target date, returns the subset that
 * applies to that date: one-offs whose `date` matches and recurring blocks
 * whose `recurring_weekday` matches the target's day-of-week.
 */
export function blocksForDate(
  blocks: AvailabilityBlockRecord[],
  date: Date
): AvailabilityBlockRecord[] {
  const key = dateKey(date);
  const dow = date.getDay();
  return blocks.filter((b) => {
    if (b.date !== null) return b.date === key;
    if (b.recurring_weekday !== null) return b.recurring_weekday === dow;
    return false;
  });
}

export interface ClassifiedBlocks {
  mode: "default" | "available";
  blockedBlocks: AvailabilityBlockRecord[];
  availableBlocks: AvailabilityBlockRecord[];
}

/**
 * Classifies the blocks that apply to a date into rendering groups.
 * Mode is "available" when at least one `is_blocked: false` block applies;
 * callers then render the inverse of those windows as unavailable.
 */
export function classifyBlocksForDate(
  blocks: AvailabilityBlockRecord[],
  date: Date
): ClassifiedBlocks {
  const applicable = blocksForDate(blocks, date);
  const blockedBlocks: AvailabilityBlockRecord[] = [];
  const availableBlocks: AvailabilityBlockRecord[] = [];
  for (const b of applicable) {
    if (b.is_blocked) blockedBlocks.push(b);
    else availableBlocks.push(b);
  }
  return {
    mode: availableBlocks.length > 0 ? "available" : "default",
    blockedBlocks,
    availableBlocks,
  };
}

function timeStrToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Given a set of "available" time windows on a single day and the visible
 * time-grid bounds, returns the inverse intervals — the gaps that should
 * render as implicit unavailable striping in the week view.
 *
 * Windows are clamped to [gridStartHour, gridEndHour) and overlapping ones
 * are merged before walking the gaps.
 */
export function inverseAvailabilityWindows(
  windows: Array<{ start_time: string; end_time: string }>,
  gridStartHour: number,
  gridEndHour: number
): Array<{ start_time: string; end_time: string }> {
  const gridStartMin = gridStartHour * 60;
  const gridEndMin = gridEndHour * 60;

  const sorted = [...windows].sort(
    (a, b) => timeStrToMinutes(a.start_time) - timeStrToMinutes(b.start_time)
  );

  const merged: Array<{ startMin: number; endMin: number }> = [];
  for (const w of sorted) {
    const startMin = Math.max(timeStrToMinutes(w.start_time), gridStartMin);
    const endMin = Math.min(timeStrToMinutes(w.end_time), gridEndMin);
    if (endMin <= startMin) continue;
    const last = merged[merged.length - 1];
    if (last && startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, endMin);
    } else {
      merged.push({ startMin, endMin });
    }
  }

  const gaps: Array<{ start_time: string; end_time: string }> = [];
  let cursor = gridStartMin;
  for (const w of merged) {
    if (cursor < w.startMin) {
      gaps.push({
        start_time: minutesToTimeStr(cursor),
        end_time: minutesToTimeStr(w.startMin),
      });
    }
    cursor = Math.max(cursor, w.endMin);
  }
  if (cursor < gridEndMin) {
    gaps.push({
      start_time: minutesToTimeStr(cursor),
      end_time: minutesToTimeStr(gridEndMin),
    });
  }

  return gaps;
}
