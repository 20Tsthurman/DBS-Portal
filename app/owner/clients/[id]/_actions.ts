"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type FileRecord,
} from "@/lib/supabase";
import {
  buildStoragePath,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteStorageObject,
  readUploadedObjectMetadata,
} from "@/lib/storage";
import type { ActionResult } from "@/lib/actions";

const MAX_FILENAME_LENGTH = 255;

/**
 * UI-facing file-type vocabulary for Phase 5. The schema CHECK on
 * `files.file_type` still permits `contract` and `invoice` for later
 * phases; this enum scopes what the upload UI is allowed to write.
 */
type UiFileType = "content" | "other";
const UI_FILE_TYPES: UiFileType[] = ["content", "other"];

/**
 * Confirm the targeted client exists and is not soft-deleted. Returns
 * the row on success or an ActionResult error on failure so the calling
 * action can short-circuit.
 */
async function loadActiveClient(
  clientId: string
): Promise<
  | { ok: true; client: ClientRecord }
  | { ok: false; error: string }
> {
  if (!clientId) return { ok: false, error: "Missing client id" };
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const client = data as ClientRecord | null;
  if (!client) return { ok: false, error: "Client not found" };
  if (client.status === "inactive") {
    return { ok: false, error: "Client is inactive" };
  }
  return { ok: true, client };
}

// ---------------------------------------------------------------------------
// Upload — step 1: mint a signed upload URL
//
// Browser receives `signedUrl` and PUTs the file body to it directly.
// Nothing has been persisted yet at this point — if the user closes the
// tab or the PUT fails, we leak nothing (no DB row, no orphaned object).
// ---------------------------------------------------------------------------

export interface CreateFileUploadUrlInput {
  clientId: string;
  filename: string;
}

export async function createFileUploadUrlAction(
  input: CreateFileUploadUrlInput
): Promise<
  ActionResult<{ signedUrl: string; token: string; storagePath: string }>
> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const trimmedName = input.filename.trim();
  if (!trimmedName) return { ok: false, error: "Filename is required" };
  if (trimmedName.length > MAX_FILENAME_LENGTH) {
    return { ok: false, error: "Filename is too long" };
  }

  const clientCheck = await loadActiveClient(input.clientId);
  if (!clientCheck.ok) return { ok: false, error: clientCheck.error };

  const storagePath = buildStoragePath(input.clientId, trimmedName);

  try {
    const { signedUrl, token } = await createSignedUploadUrl(storagePath);
    return { ok: true, data: { signedUrl, token, storagePath } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start upload",
    };
  }
}

// ---------------------------------------------------------------------------
// Upload — step 2: persist the row after the browser PUT completes
//
// `readUploadedObjectMetadata` proves the object actually landed in
// storage; a missing object means the browser PUT failed and we should
// NOT insert a phantom row.
// ---------------------------------------------------------------------------

export interface FinalizeFileUploadInput {
  clientId: string;
  storagePath: string;
  filename: string;
  fileType: UiFileType;
}

export async function finalizeFileUploadAction(
  input: FinalizeFileUploadInput
): Promise<ActionResult<FileRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const trimmedName = input.filename.trim();
  if (!trimmedName) return { ok: false, error: "Filename is required" };
  if (trimmedName.length > MAX_FILENAME_LENGTH) {
    return { ok: false, error: "Filename is too long" };
  }
  if (!UI_FILE_TYPES.includes(input.fileType)) {
    return { ok: false, error: "Invalid file type" };
  }
  if (!input.storagePath) {
    return { ok: false, error: "Missing storage path" };
  }
  // The path is minted server-side as `{clientId}/...`; enforce that the
  // caller didn't tamper with the prefix to write into another client's
  // folder.
  if (!input.storagePath.startsWith(`${input.clientId}/`)) {
    return { ok: false, error: "Storage path does not match client" };
  }

  const clientCheck = await loadActiveClient(input.clientId);
  if (!clientCheck.ok) return { ok: false, error: clientCheck.error };

  let mimeType: string;
  let sizeBytes: number;
  try {
    const meta = await readUploadedObjectMetadata(input.storagePath);
    mimeType = meta.mimeType;
    sizeBytes = meta.sizeBytes;
  } catch {
    return { ok: false, error: "Upload did not complete" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("files")
    .insert({
      client_id: input.clientId,
      name: trimmedName,
      storage_path: input.storagePath,
      file_type: input.fileType,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      uploaded_by: guard.ownerLabel,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Failed to save file record",
    };
  }

  revalidatePath(`/owner/clients/${input.clientId}`);
  return { ok: true, data: data as FileRecord };
}

// ---------------------------------------------------------------------------
// Owner-side download URL
//
// Parallel to the client-side action in app/client/files/_actions.ts but
// without the cross-client check — the owner is allowed to download any
// file. Returns the same shape so the FilesPanel can reuse the
// "open in new tab" handler.
// ---------------------------------------------------------------------------

export interface CreateOwnerFileDownloadUrlInput {
  fileId: string;
}

export async function createOwnerFileDownloadUrlAction(
  input: CreateOwnerFileDownloadUrlInput
): Promise<ActionResult<{ signedUrl: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

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

// ---------------------------------------------------------------------------
// Delete — DB row first, then storage object.
//
// If the storage delete fails we log it but still return `{ ok: true }`
// to the caller: from the user's perspective the file is gone (no longer
// listed, no longer downloadable). An orphaned storage object is cheap
// and can be cleaned up out of band.
// ---------------------------------------------------------------------------

export interface DeleteFileInput {
  fileId: string;
}

export async function deleteFileAction(
  input: DeleteFileInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.fileId) return { ok: false, error: "Missing file id" };

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: lookupError } = await supabase
    .from("files")
    .select("*")
    .eq("id", input.fileId)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };
  const file = existing as FileRecord | null;
  if (!file) return { ok: false, error: "File not found" };

  const { error: deleteError } = await supabase
    .from("files")
    .delete()
    .eq("id", input.fileId);
  if (deleteError) return { ok: false, error: deleteError.message };

  try {
    await deleteStorageObject(file.storage_path);
  } catch (err) {
    console.error(
      `[files] storage delete failed for ${file.storage_path}:`,
      err
    );
  }

  revalidatePath(`/owner/clients/${file.client_id}`);
  return { ok: true };
}
