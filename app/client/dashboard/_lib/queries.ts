import {
  getSupabaseServiceClient,
  type MessageRecord,
  type ProjectRecord,
} from "@/lib/supabase";

/**
 * The signed-in client's project, or null if they don't have one yet.
 *
 * A client has at most one active project in practice, but the table
 * permits more than one row per client, so we mirror the owner-side
 * ordering (`start_date` desc, nulls last) and take the first — the most
 * recently started project is the one the dashboard tracks. Caller has
 * already proven identity via `requireCurrentClient()` and passes
 * `clientId` in directly; we scope by `client_id` rather than RLS.
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
