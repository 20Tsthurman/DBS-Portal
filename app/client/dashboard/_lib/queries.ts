import {
  getSupabaseServiceClient,
  type MessageRecord,
} from "@/lib/supabase";

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
