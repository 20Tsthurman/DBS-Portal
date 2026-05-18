import {
  getSupabaseServiceClient,
  type FileRecord,
} from "@/lib/supabase";

/**
 * Files belonging to a single client, newest first. Throws on Supabase
 * error — matches the throw-on-error contract used by the financials
 * fetchers (server components bubble to React error boundary).
 */
export async function fetchFilesForClient(
  clientId: string
): Promise<FileRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FileRecord[];
}
