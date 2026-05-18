import {
  getSupabaseServiceClient,
  type FileRecord,
} from "@/lib/supabase";

/**
 * Files for the signed-in client. Identical shape to the owner-side
 * `fetchFilesForClient`, but kept separate because the client-side
 * caller has already proven identity via `requireCurrentClient()` and
 * passes `client.id` in directly. Newest first.
 */
export async function fetchMyFiles(clientId: string): Promise<FileRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FileRecord[];
}
