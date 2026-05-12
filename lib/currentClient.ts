import { currentUser } from "@clerk/nextjs/server";
import { getSupabaseServiceClient, type ClientRecord } from "@/lib/supabase";

/**
 * Resolves the signed-in Clerk user to their `clients` row.
 *
 * Returns null in three cases:
 *   - No signed-in user
 *   - Signed-in user has role !== "client" in publicMetadata
 *   - No `clients` row exists with `clerk_user_id` matching the user's id
 *
 * Server-only. Throws on Supabase errors (per the query convention in
 * docs/features/scheduling.md §"Server actions vs. queries"): callers
 * are server components, so a thrown error escalates to the request's
 * React error boundary. Owner-role users always resolve to null —
 * cross-role access is the layout's concern, not this helper's.
 */
export async function getCurrentClient(): Promise<ClientRecord | null> {
  const user = await currentUser();
  if (!user) return null;
  if (user.publicMetadata?.role !== "client") return null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("clerk_user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return (data as ClientRecord | null) ?? null;
}

/**
 * Same as getCurrentClient, but throws if there is no signed-in client.
 * Used by server actions where "no client" is unrecoverable (vs. server
 * components which can gracefully render a "not signed in" state).
 */
export async function requireCurrentClient(): Promise<ClientRecord> {
  const client = await getCurrentClient();
  if (!client) throw new Error("Not signed in as a client");
  return client;
}
