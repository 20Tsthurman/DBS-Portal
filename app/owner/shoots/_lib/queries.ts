import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ShootRecord,
} from "@/lib/supabase";

export type ShootWithClientName = ShootRecord & { client_name: string };

/** Fetch upcoming shoots (scheduled_at >= now, status requested/confirmed) with client name attached, ascending. */
export async function fetchUpcomingShoots(
  limit?: number
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("shoots")
    .select("*")
    .in("status", ["requested", "confirmed"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return attachClientNames(supabase, (data ?? []) as ShootRecord[]);
}

/** Fetch past shoots (scheduled_at < now or status completed/cancelled) with client name attached, descending. */
export async function fetchPastShoots(
  limit?: number
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("shoots")
    .select("*")
    .or(`scheduled_at.lt.${nowIso},status.in.(completed,cancelled)`)
    .order("scheduled_at", { ascending: false });

  if (typeof limit === "number") {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return attachClientNames(supabase, (data ?? []) as ShootRecord[]);
}

/** Fetch all shoots within [start, end) (timestamp range) with client name attached, ordered by scheduled_at ascending. */
export async function fetchShootsInRange(
  start: Date,
  end: Date
): Promise<ShootWithClientName[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("shoots")
    .select("*")
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw new Error(error.message);
  return attachClientNames(supabase, (data ?? []) as ShootRecord[]);
}

async function attachClientNames(
  supabase: SupabaseClient,
  shoots: ShootRecord[]
): Promise<ShootWithClientName[]> {
  if (shoots.length === 0) return [];

  const clientIds = Array.from(new Set(shoots.map((s) => s.client_id)));
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (error) throw new Error(error.message);

  const nameById = new Map<string, string>();
  for (const row of (data ?? []) as Pick<ClientRecord, "id" | "name">[]) {
    nameById.set(row.id, row.name);
  }

  return shoots.map((s) => ({
    ...s,
    client_name: nameById.get(s.client_id) ?? "",
  }));
}
