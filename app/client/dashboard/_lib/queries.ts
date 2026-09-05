import {
  getSupabaseServiceClient,
  type MessageRecord,
  type ProjectRecord,
} from "@/lib/supabase";
import {
  CLIENT_ONBOARDING_TOUR_KEY,
  CLIENT_ONBOARDING_TOUR_VERSION,
} from "@/lib/tours";

/**
 * The single most recent message in the signed-in client's thread,
 * regardless of who sent it (owner or client). Used for the dashboard
 * activity feed. Returns null when no messages have been exchanged yet.
 */
export async function fetchMyLastMessage(
  clientId: string
): Promise<MessageRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MessageRecord | null) ?? null;
}

/**
 * The signed-in client's project row, for the dashboard phase tracker.
 * Returns null when no row exists yet — reachable whenever a client was
 * invited or added without a package, since every creation path only
 * inserts a project alongside a package id. The page treats null as
 * 'onboarding'; see the comment there.
 *
 * Picks the row the same way the owner side does (`fetchClientDetail` and
 * the notes/pricing actions: most recent start_date, nulls last, limit 1).
 * Nothing enforces one project per client at the schema level, so if a
 * second row ever appeared, the client and Kelsey would still be looking at
 * the same one.
 */
export async function fetchMyProject(
  clientId: string
): Promise<ProjectRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProjectRecord | null) ?? null;
}

/**
 * Has this person already finished with the client onboarding tour?
 *
 * The gate for Tour 1. An exact three-column match on
 * (clerk_user_id, tour_key, version), which migration 021 covers with a
 * UNIQUE — and therefore with the only index this read needs.
 *
 * The ROW is the answer; `outcome` is never consulted. A client who skipped
 * the tour has decided not to see it, exactly as firmly as one who finished
 * it, and re-firing it at them would be the portal arguing.
 *
 * Called from the dashboard page AFTER `requireCurrentClient()` resolves, so
 * it never runs on the path where a client has no linked `clients` row yet.
 */
export async function fetchClientOnboardingTourSeen(
  clerkUserId: string
): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tour_completions")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("tour_key", CLIENT_ONBOARDING_TOUR_KEY)
    .eq("version", CLIENT_ONBOARDING_TOUR_VERSION)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}
