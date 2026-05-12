import {
  getSupabaseServiceClient,
  type AvailabilityBlockRecord,
  type ShootRecord,
} from "@/lib/supabase";
import { requireCurrentClient } from "@/lib/currentClient";
import { dateKey } from "@/app/owner/calendar/_lib/dateMath";

/** Fetch the signed-in client's shoots in [start, end), ascending by scheduled_at. */
export async function fetchMyShootsInRange(
  start: Date,
  end: Date
): Promise<ShootRecord[]> {
  const { id: clientId } = await requireCurrentClient();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .eq("client_id", clientId)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ShootRecord[];
}

/** Fetch the signed-in client's upcoming requested/confirmed shoots, ascending. */
export async function fetchMyUpcomingShoots(
  limit?: number
): Promise<ShootRecord[]> {
  const { id: clientId } = await requireCurrentClient();
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("shoots")
    .select("*")
    .eq("client_id", clientId)
    .in("status", ["requested", "confirmed"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ShootRecord[];
}

/**
 * Fetch all availability_blocks relevant to [start, end) — one-offs in range
 * plus every recurring block. Gated on a signed-in client session even though
 * availability is global to Kelsey; callers use `blocksForDate` to expand per day.
 */
export async function fetchAvailabilityBlocksForClient(
  start: Date,
  end: Date
): Promise<AvailabilityBlockRecord[]> {
  await requireCurrentClient();
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
