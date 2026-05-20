import { getSupabaseServiceClient } from "@/lib/supabase";

/**
 * The single Supabase Storage bucket used for client-facing files
 * (deliverables, references, briefs, mood boards). Service-role only —
 * the bucket has no RLS, no public access. Reads and writes always go
 * through signed URLs minted server-side.
 */
export const FILES_BUCKET = "client-files";

/** Signed upload URLs live 60s; clients PUT immediately after minting. */
const UPLOAD_URL_TTL_SECONDS = 60;

/** Signed download URLs live one hour; long enough for a click-through. */
const DOWNLOAD_URL_TTL_SECONDS = 3600;

/**
 * Sanitize a user-supplied filename so it's safe to drop into a storage
 * path. Strips leading dots (no hidden files), replaces every character
 * outside `[A-Za-z0-9._-]` with `_`, collapses runs of underscores, and
 * caps the result at 100 chars. The uuid prefix in `buildStoragePath`
 * guarantees uniqueness even when two clients upload the same name.
 *
 * Falls back to `"file"` if sanitization eats the whole string.
 */
function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim().replace(/^\.+/, "");
  const replaced = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
  const collapsed = replaced.replace(/_+/g, "_");
  const capped = collapsed.slice(0, 100);
  return capped.length > 0 ? capped : "file";
}

/**
 * Build the canonical storage key for a new upload. Format:
 * `{clientId}/{uuid}-{sanitized-filename}`. The per-file uuid prevents
 * collisions when the same filename is uploaded twice.
 */
export function buildStoragePath(clientId: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  return `${clientId}/${crypto.randomUUID()}-${safe}`;
}

/**
 * Mint a one-shot signed upload URL the browser can PUT to directly.
 * The returned `token` is what `uploadToSignedUrl` expects if a caller
 * ever wants to use the SDK helper rather than a raw `fetch(... PUT)`.
 *
 * Throws on Supabase error — callers wrap this in their server-action
 * try/catch and convert to an `ActionResult`.
 */
export async function createSignedUploadUrl(
  storagePath: string
): Promise<{ signedUrl: string; token: string }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new Error(
      error?.message ?? "Failed to create signed upload URL"
    );
  }
  return { signedUrl: data.signedUrl, token: data.token };
}

/**
 * Mint a time-limited download URL. The `filename` arg sets the
 * Content-Disposition response header so browsers download with a
 * sensible name (rather than the uuid-prefixed storage key).
 *
 * Throws on Supabase error.
 */
export async function createSignedDownloadUrl(
  storagePath: string,
  filename: string
): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS, {
      download: filename,
    });
  if (error || !data) {
    throw new Error(
      error?.message ?? "Failed to create signed download URL"
    );
  }
  return data.signedUrl;
}

/**
 * Upload a server-generated buffer (PDF, etc.) directly to storage. The
 * buffer never leaves the server, so going through the signed-URL flow
 * (which is built for browser uploads) would be pointless. Used by the
 * invoice send/edit actions to write the generated PDF into the
 * `client-files` bucket.
 *
 * `upsert = true` overwrites an existing object at the same path; the
 * invoice edit flow uses this to regenerate the PDF in place without
 * touching the originating `files` row. Default is `false` (fresh
 * upload, conflict surfaces as an error).
 *
 * Throws on Supabase error.
 */
export async function uploadServerBuffer(
  storagePath: string,
  buffer: Buffer,
  mimeType: string,
  upsert?: boolean
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: upsert ?? false,
    });
  if (error) throw new Error(error.message);
}

/**
 * Hard-delete the storage object at `storagePath`. Throws on Supabase
 * error. Per the Phase 5 contract, callers delete the DB row first; a
 * storage failure here is logged but does NOT roll back the row delete.
 */
export async function deleteStorageObject(storagePath: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .remove([storagePath]);
  if (error) throw new Error(error.message);
}

/**
 * Read MIME + size from a completed upload. Used by
 * `finalizeFileUploadAction` so the row reflects what actually landed in
 * Storage rather than what the browser claimed. Throws if the object is
 * missing or unreadable — callers translate that into an
 * "upload did not complete" error response.
 *
 * Implementation: Supabase's `list()` returns object metadata including
 * `size` and `mimetype`. We list the parent folder filtered to the exact
 * filename so the call stays O(1) regardless of how many files the
 * client has.
 */
export async function readUploadedObjectMetadata(
  storagePath: string
): Promise<{ mimeType: string; sizeBytes: number }> {
  const slash = storagePath.lastIndexOf("/");
  if (slash === -1) {
    throw new Error("Invalid storage path");
  }
  const prefix = storagePath.slice(0, slash);
  const filename = storagePath.slice(slash + 1);

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .list(prefix, { limit: 1, search: filename });
  if (error) throw new Error(error.message);

  const match = (data ?? []).find((row) => row.name === filename);
  if (!match) {
    throw new Error("Uploaded object not found in storage");
  }

  const metadata = (match.metadata ?? {}) as {
    size?: number;
    mimetype?: string;
  };
  return {
    mimeType: metadata.mimetype ?? "application/octet-stream",
    sizeBytes: typeof metadata.size === "number" ? metadata.size : 0,
  };
}
