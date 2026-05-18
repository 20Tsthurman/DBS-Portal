"use server";

import { requireCurrentClient } from "@/lib/currentClient";
import {
  getSupabaseServiceClient,
  type FileRecord,
} from "@/lib/supabase";
import { createSignedDownloadUrl } from "@/lib/storage";
import type { ActionResult } from "@/lib/actions";

export interface CreateFileDownloadUrlInput {
  fileId: string;
}

/**
 * Mint a one-hour signed download URL for a single file belonging to
 * the signed-in client. Cross-client access is the primary risk here —
 * the action explicitly compares `file.client_id === client.id` and
 * returns "Forbidden" on mismatch, so a forged `fileId` from another
 * client's row cannot leak content.
 */
export async function createFileDownloadUrlAction(
  input: CreateFileDownloadUrlInput
): Promise<ActionResult<{ signedUrl: string }>> {
  let client;
  try {
    client = await requireCurrentClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Not signed in",
    };
  }

  if (!input.fileId) return { ok: false, error: "Missing file id" };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", input.fileId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const file = data as FileRecord | null;
  if (!file) return { ok: false, error: "File not found" };

  if (file.client_id !== client.id) {
    return { ok: false, error: "Forbidden" };
  }

  try {
    const signedUrl = await createSignedDownloadUrl(file.storage_path, file.name);
    return { ok: true, data: { signedUrl } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not generate link",
    };
  }
}
