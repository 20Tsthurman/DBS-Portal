import {
  getSupabaseServiceClient,
  type ShootRecord,
} from "@/lib/supabase";
import { requireCurrentClient } from "@/lib/currentClient";

/**
 * Fetch the signed-in client's shoots whose `scheduled_at` falls in
 * [start, end). Ordered by scheduled_at ascending.
 *
 * The auth gate is the call to `requireCurrentClient` — we use the service
 * client and scope by client_id rather than relying on RLS.
 */
export async function fetchMyShootsInRange(
  start: Date,
  end: Date
): Promise<ShootRecord[]> {
  const client = await requireCurrentClient();
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .eq("client_id", client.id)
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ShootRecord[];
}

/**
 * Fetch the signed-in client's upcoming shoots (requested + confirmed),
 * starting at the current instant. Ordered by scheduled_at ascending.
 * Cancelled and completed shoots are excluded.
 */
export async function fetchMyUpcomingShoots(): Promise<ShootRecord[]> {
  const client = await requireCurrentClient();
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .eq("client_id", client.id)
    .in("status", ["requested", "confirmed"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ShootRecord[];
}

/**
 * Fetch one of the signed-in client's shoots by id. Returns null if the shoot
 * does not exist OR if it belongs to a different client. This second check is
 * the privacy gate — a client cannot view another client's shoot detail even
 * by URL manipulation.
 */
export async function fetchMyShoot(id: string): Promise<ShootRecord | null> {
  if (!id) return null;
  const client = await requireCurrentClient();
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const shoot = (data as ShootRecord | null) ?? null;
  if (!shoot) return null;
  if (shoot.client_id !== client.id) return null;
  return shoot;
}
