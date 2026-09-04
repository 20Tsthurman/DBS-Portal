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
 * Cancelled, declined and completed shoots are excluded — nothing is
 * booked for any of them, so none belongs under "Upcoming". Declines get
 * their own notice (`fetchMyRecentDeclines`).
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

/** How long a declined request keeps its spot in the notice above the calendar. */
const DECLINE_NOTICE_DAYS = 14;

/**
 * Fetch the declined requests worth telling the client about right now.
 *
 * Two windows, OR'd, because either one alone leaves a hole:
 *
 *   - `scheduled_at` still in the future — the date they asked for hasn't
 *     passed, so they may still want to rebook near it. This covers a
 *     request declined months ago for a date next week.
 *   - declined within the last `DECLINE_NOTICE_DAYS` — the answer is fresh
 *     news even if the date has come and gone. This covers a request for
 *     tomorrow that Kelsey declined today and the client reads next week.
 *
 * Outside both, the decline is old news; it stays visible on the calendar
 * grid and via `?shoot=<id>`, it just stops leading the page.
 */
export async function fetchMyRecentDeclines(): Promise<ShootRecord[]> {
  const client = await requireCurrentClient();
  const supabase = getSupabaseServiceClient();

  const nowIso = new Date().toISOString();
  const cutoffIso = new Date(
    Date.now() - DECLINE_NOTICE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .eq("client_id", client.id)
    .eq("status", "declined")
    .or(`scheduled_at.gte.${nowIso},declined_at.gte.${cutoffIso}`)
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
