import {
  getSupabaseServiceClient,
  type ShootRecord,
  type TimeBlockRecord,
} from "@/lib/supabase";
import {
  combineDateAndTimeInTimezone,
  dateKeyInTimezone,
} from "@/app/owner/calendar/_lib/timezone";

/**
 * Result of a booking-conflict check.
 *
 * Privacy rule: this is the ONLY public surface. We never expose the
 * underlying records (IDs, client names, labels, locations, anything). A
 * client must never be able to learn what's on Kelsey's calendar — only
 * whether *something* overlaps.
 */
export interface ConflictSummary {
  count: number;
}

// Same cap the booking form enforces. Lets us bound the database scan for
// shoots whose `scheduled_at` precedes the proposed window without
// computing `scheduled_at + duration_hours` in SQL.
const MAX_DURATION_HOURS = 12;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Whether `[startsAt, endsAt)` overlaps with any existing shoot (any status
 * except cancelled) or any time_block on the owner's calendar. Boundary
 * touches do NOT count as conflicts — strict `<` / `>`, not `<=` / `>=`.
 *
 * Returns only the total count; see {@link ConflictSummary}.
 */
export async function checkBookingConflicts(
  startsAt: Date,
  endsAt: Date
): Promise<ConflictSummary> {
  const supabase = getSupabaseServiceClient();

  const shootScanLo = new Date(
    startsAt.getTime() - MAX_DURATION_HOURS * HOUR_MS
  );
  const blocksDateLo = dateKeyInTimezone(startsAt);
  const blocksDateHi = dateKeyInTimezone(new Date(endsAt.getTime() + DAY_MS));

  const [shootsRes, blocksRes] = await Promise.all([
    supabase
      .from("shoots")
      .select("scheduled_at, duration_hours, status")
      .neq("status", "cancelled")
      .gte("scheduled_at", shootScanLo.toISOString())
      .lt("scheduled_at", endsAt.toISOString()),
    supabase
      .from("time_blocks")
      .select("date, start_time, end_time")
      .gte("date", blocksDateLo)
      .lt("date", blocksDateHi),
  ]);

  if (shootsRes.error) throw new Error(shootsRes.error.message);
  if (blocksRes.error) throw new Error(blocksRes.error.message);

  const shoots = (shootsRes.data ?? []) as Pick<
    ShootRecord,
    "scheduled_at" | "duration_hours" | "status"
  >[];
  const blocks = (blocksRes.data ?? []) as Pick<
    TimeBlockRecord,
    "date" | "start_time" | "end_time"
  >[];

  let count = 0;

  for (const s of shoots) {
    const shootStart = new Date(s.scheduled_at);
    const hours = s.duration_hours ?? 1;
    const shootEnd = new Date(shootStart.getTime() + Number(hours) * HOUR_MS);
    if (shootStart < endsAt && shootEnd > startsAt) count++;
  }

  for (const b of blocks) {
    const blockStart = combineDateAndTimeInTimezone(b.date, b.start_time);
    const blockEnd = combineDateAndTimeInTimezone(b.date, b.end_time);
    if (blockStart < endsAt && blockEnd > startsAt) count++;
  }

  return { count };
}
