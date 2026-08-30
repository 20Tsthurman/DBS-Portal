"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentCycleRecord,
  type ContentItemRecord,
  type Platform,
  type PostFormat,
} from "@/lib/supabase";
import {
  CONTENT_ASSETS_BUCKET,
  buildStoragePath,
  createSignedDownloadUrl,
  createSignedUploadUrl,
  deleteStorageObject,
  readUploadedObjectMetadata,
} from "@/lib/storage";
import {
  createResumableUploadUrl,
  deleteVideo,
  getVideoStatus,
} from "@/lib/stream";
import { combineDateAndTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import type { ActionResult } from "@/lib/actions";

const CONTENT_PATH = "/owner/content";
const MAX_FILENAME_LENGTH = 255;
const MAX_CAPTION_LENGTH = 5000;

/**
 * Byte ceiling on a review video, checked before a tus upload is minted.
 *
 * This is NOT the constraint that protects Cloudflare's storage block — the
 * 120-second `maxDurationSeconds` reservation in lib/stream.ts does that, and
 * a longer video fails during processing regardless of its size. This cap
 * protects Kelsey: it stops a mis-picked file (a full shoot export, a screen
 * recording) from committing her phone to a long cellular upload before
 * anything tells her it was the wrong file.
 *
 * 500 MB is roughly 120s of iPhone 4K/30 HEVC, so it cannot reject a clip
 * that would otherwise be accepted at the duration cap. Review clips run
 * 6–15s (spec §3.5d), which lands two orders of magnitude below this.
 */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

const PLATFORMS: Platform[] = [
  "instagram",
  "tiktok",
  "facebook",
  "youtube",
  "pinterest",
];
const FORMATS: PostFormat[] = ["reel", "feed", "story", "carousel"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** Postgres unique-violation. Surfaces from the two unique indexes on these tables. */
const PG_UNIQUE_VIOLATION = "23505";

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

async function loadCycle(
  cycleId: string
): Promise<{ ok: true; cycle: ContentCycleRecord } | { ok: false; error: string }> {
  if (!cycleId) return { ok: false, error: "Missing cycle id" };
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("id", cycleId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const cycle = data as ContentCycleRecord | null;
  if (!cycle) return { ok: false, error: "Cycle not found" };
  return { ok: true, cycle };
}

async function loadItem(
  itemId: string
): Promise<{ ok: true; item: ContentItemRecord } | { ok: false; error: string }> {
  if (!itemId) return { ok: false, error: "Missing item id" };
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const item = data as ContentItemRecord | null;
  if (!item) return { ok: false, error: "Post not found" };
  return { ok: true, item };
}

/**
 * Validate the scheduled date/time and turn it into the stored instant.
 *
 * `combineDateAndTimeInTimezone` is the only sanctioned way to build an
 * instant from wall-clock parts here — the `new Date(y, m-1, d)` constructor
 * path reads the SERVER's offset, which is UTC in production and shifts the
 * post by several hours (spec §3.9; this trap has been hit in this codebase
 * before).
 *
 * The date is also pinned to the cycle's own month: an item scheduled outside
 * it would be invisible in every month view but still cascade-delete with the
 * cycle.
 */
function resolveScheduledFor(
  cycle: ContentCycleRecord,
  date: string,
  time: string
): { ok: true; scheduledFor: string } | { ok: false; error: string } {
  if (!DATE_RE.test(date)) return { ok: false, error: "Invalid date" };
  if (!TIME_RE.test(time)) return { ok: false, error: "Invalid time" };
  const cycleMonthKey = cycle.month.slice(0, 7);
  if (date.slice(0, 7) !== cycleMonthKey) {
    return {
      ok: false,
      error: `Date must fall inside the cycle month (${cycleMonthKey})`,
    };
  }
  return {
    ok: true,
    scheduledFor: combineDateAndTimeInTimezone(date, time).toISOString(),
  };
}

function validateCaption(
  raw: string | undefined
): { ok: true; caption: string | null } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > MAX_CAPTION_LENGTH) {
    return { ok: false, error: "Caption is too long" };
  }
  return { ok: true, caption: trimmed.length > 0 ? trimmed : null };
}

/**
 * Storage paths for a set of items' Supabase-backed assets, so the caller can
 * sweep the objects after the cascading row delete. Stream-backed assets are
 * skipped here and handled by `streamUidsForItems` + `deleteStreamVideos`
 * below, which run BEFORE the row delete rather than after it.
 */
async function supabaseAssetPathsForItems(
  itemIds: string[]
): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("external_id, provider")
    .in("content_item_id", itemIds)
    .eq("provider", "supabase");
  if (error) return [];
  return ((data ?? []) as Array<{ external_id: string }>).map(
    (row) => row.external_id
  );
}

/**
 * Best-effort object sweep after a cascading delete. Mirrors the files
 * feature's contract: the DB row goes first and a storage failure is logged
 * rather than rolled back — an orphaned object is cheap, a phantom row is not.
 *
 * DO NOT reuse this shape for Stream. See `deleteStreamVideos` below.
 */
async function sweepStorageObjects(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await deleteStorageObject(path, CONTENT_ASSETS_BUCKET);
    } catch (err) {
      console.error("content-assets sweep failed", path, err);
    }
  }
}

/**
 * Stream video UIDs for a set of items' live AND superseded assets.
 *
 * No `replaced_at is null` filter, deliberately: a superseded asset row still
 * points at a real video that is still being billed, and the cascading delete
 * takes those rows too.
 */
async function streamUidsForItems(itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("external_id, provider")
    .in("content_item_id", itemIds)
    .eq("provider", "stream");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ external_id: string }>).map(
    (row) => row.external_id
  );
}

/**
 * Delete Stream videos BEFORE the rows that point at them, aborting on the
 * first real failure.
 *
 * This is the inverse of `sweepStorageObjects` and the inversion is the whole
 * point (spec §3.5c, and the warning on `deleteVideo` in lib/stream.ts).
 * Nothing relates `content_assets.external_id` to Cloudflare — no foreign
 * key, no reconciliation job, no listing anywhere in the app. Delete the row
 * first and a failed Stream delete leaves a video that bills storage minutes
 * against the prepaid block forever with nothing left that knows its UID. An
 * asset row pointing at an already-deleted video is the opposite: visible,
 * cheap, and fixable.
 *
 * So the caller must treat a non-ok result as fatal and leave every row where
 * it is. A retry then re-attempts the whole set, which is why an already-gone
 * video counts as success below.
 *
 * A 404 is matched on the thrown message because that is the only signal
 * lib/stream.ts exposes — it throws on 404 by design, since it cannot tell an
 * already-deleted video from a mistyped UID that is still costing money. At
 * THIS call site we can: we are deleting, and a video that is already gone is
 * the outcome we wanted. Without this, one partially-completed sweep would
 * wedge the delete permanently on its own second attempt.
 */
async function deleteStreamVideos(
  uids: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const uid of uids) {
    try {
      await deleteVideo(uid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/HTTP 404/.test(message)) continue;
      return {
        ok: false,
        error: `Could not delete the video from Cloudflare, so nothing was removed. Try again. (${message})`,
      };
    }
  }
  return { ok: true };
}

/**
 * The next free carousel slot on an item: one past the highest live position,
 * or 0 when the item has no assets.
 *
 * Two concurrent callers can still pick the same slot — the partial unique
 * index `content_assets_current_position_idx` rejects the loser rather than
 * silently producing two assets at one position. Every insert path below
 * catches PG_UNIQUE_VIOLATION and says so in words.
 */
async function nextAssetPosition(itemId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("position")
    .eq("content_item_id", itemId)
    .is("replaced_at", null)
    .order("position", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ position: number }>;
  return rows.length > 0 ? rows[0].position + 1 : 0;
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

export interface CreateContentCycleInput {
  clientId: string;
  /** YYYY-MM. Stored as the first of that month. */
  monthKey: string;
  includedRounds: number;
  extraRoundPrice: number | null;
}

export async function createContentCycleAction(
  input: CreateContentCycleInput
): Promise<ActionResult<ContentCycleRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Select a client" };
  if (!/^\d{4}-\d{2}$/.test(input.monthKey)) {
    return { ok: false, error: "Invalid month" };
  }
  if (!Number.isInteger(input.includedRounds) || input.includedRounds < 0) {
    return { ok: false, error: "Included rounds must be a whole number" };
  }
  if (input.extraRoundPrice !== null && !(input.extraRoundPrice >= 0)) {
    return { ok: false, error: "Extra round price must be zero or more" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .insert({
      client_id: input.clientId,
      month: `${input.monthKey}-01`,
      included_rounds: input.includedRounds,
      extra_round_price: input.extraRoundPrice,
      status: "drafting",
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "This client already has a cycle for that month",
      };
    }
    return { ok: false, error: error?.message ?? "Failed to create cycle" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: data as ContentCycleRecord };
}

export interface UpdateContentCycleInput {
  cycleId: string;
  includedRounds: number;
  extraRoundPrice: number | null;
}

export async function updateContentCycleAction(
  input: UpdateContentCycleInput
): Promise<ActionResult<ContentCycleRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(input.cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };

  if (!Number.isInteger(input.includedRounds) || input.includedRounds < 0) {
    return { ok: false, error: "Included rounds must be a whole number" };
  }
  if (input.extraRoundPrice !== null && !(input.extraRoundPrice >= 0)) {
    return { ok: false, error: "Extra round price must be zero or more" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .update({
      included_rounds: input.includedRounds,
      extra_round_price: input.extraRoundPrice,
    })
    .eq("id", input.cycleId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to save cycle" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: data as ContentCycleRecord };
}

/**
 * Deleting a cycle cascades to its items and their assets (FKs in migration
 * 015). Storage objects are swept afterwards, best-effort.
 */
export async function deleteContentCycleAction(
  cycleId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };

  const supabase = getSupabaseServiceClient();
  const { data: itemRows, error: itemErr } = await supabase
    .from("content_items")
    .select("id")
    .eq("cycle_id", cycleId);
  if (itemErr) return { ok: false, error: itemErr.message };

  const itemIds = ((itemRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  const paths = await supabaseAssetPathsForItems(itemIds);

  // Stream videos go before the rows: the cascade would otherwise take every
  // `content_assets` row with it and strand the videos with nothing left
  // holding their UIDs (spec §3.5c).
  let uids: string[];
  try {
    uids = await streamUidsForItems(itemIds);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
  const streamSweep = await deleteStreamVideos(uids);
  if (!streamSweep.ok) return { ok: false, error: streamSweep.error };

  const { error } = await supabase
    .from("content_cycles")
    .delete()
    .eq("id", cycleId);
  if (error) return { ok: false, error: error.message };

  await sweepStorageObjects(paths);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ContentItemFormInput {
  /** YYYY-MM-DD, PORTAL_TIMEZONE wall-clock. */
  date: string;
  /** HH:MM, PORTAL_TIMEZONE wall-clock. */
  time: string;
  platform: Platform;
  format: PostFormat;
  caption: string;
}

export interface CreateContentItemInput extends ContentItemFormInput {
  cycleId: string;
}

export async function createContentItemAction(
  input: CreateContentItemInput
): Promise<ActionResult<ContentItemRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(input.cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };
  const { cycle } = cycleCheck;

  if (!PLATFORMS.includes(input.platform)) {
    return { ok: false, error: "Invalid platform" };
  }
  if (!FORMATS.includes(input.format)) {
    return { ok: false, error: "Invalid format" };
  }
  const when = resolveScheduledFor(cycle, input.date, input.time);
  if (!when.ok) return { ok: false, error: when.error };
  const captionCheck = validateCaption(input.caption);
  if (!captionCheck.ok) return { ok: false, error: captionCheck.error };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_items")
    .insert({
      client_id: cycle.client_id,
      cycle_id: cycle.id,
      scheduled_for: when.scheduledFor,
      platform: input.platform,
      format: input.format,
      caption: captionCheck.caption,
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create post" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: data as ContentItemRecord };
}

export interface UpdateContentItemInput extends ContentItemFormInput {
  itemId: string;
}

export async function updateContentItemAction(
  input: UpdateContentItemInput
): Promise<ActionResult<ContentItemRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const itemCheck = await loadItem(input.itemId);
  if (!itemCheck.ok) return { ok: false, error: itemCheck.error };
  const cycleCheck = await loadCycle(itemCheck.item.cycle_id);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };

  if (!PLATFORMS.includes(input.platform)) {
    return { ok: false, error: "Invalid platform" };
  }
  if (!FORMATS.includes(input.format)) {
    return { ok: false, error: "Invalid format" };
  }
  const when = resolveScheduledFor(cycleCheck.cycle, input.date, input.time);
  if (!when.ok) return { ok: false, error: when.error };
  const captionCheck = validateCaption(input.caption);
  if (!captionCheck.ok) return { ok: false, error: captionCheck.error };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_items")
    .update({
      scheduled_for: when.scheduledFor,
      platform: input.platform,
      format: input.format,
      caption: captionCheck.caption,
    })
    .eq("id", input.itemId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to save post" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: data as ContentItemRecord };
}

export async function deleteContentItemAction(
  itemId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const itemCheck = await loadItem(itemId);
  if (!itemCheck.ok) return { ok: false, error: itemCheck.error };

  const paths = await supabaseAssetPathsForItems([itemId]);

  // Same ordering as the cycle delete: Cloudflare first, rows second.
  let uids: string[];
  try {
    uids = await streamUidsForItems([itemId]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
  const streamSweep = await deleteStreamVideos(uids);
  if (!streamSweep.ok) return { ok: false, error: streamSweep.error };

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("content_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  await sweepStorageObjects(paths);
  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Photo assets — step 1: mint a signed upload URL
//
// Same three-step shape as the files feature: nothing is persisted here, so
// an abandoned PUT leaves no row and no orphaned object. The only difference
// is the bucket.
// ---------------------------------------------------------------------------

export interface CreateContentAssetUploadUrlInput {
  itemId: string;
  filename: string;
}

export async function createContentAssetUploadUrlAction(
  input: CreateContentAssetUploadUrlInput
): Promise<ActionResult<{ signedUrl: string; storagePath: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const trimmedName = input.filename.trim();
  if (!trimmedName) return { ok: false, error: "Filename is required" };
  if (trimmedName.length > MAX_FILENAME_LENGTH) {
    return { ok: false, error: "Filename is too long" };
  }

  const itemCheck = await loadItem(input.itemId);
  if (!itemCheck.ok) return { ok: false, error: itemCheck.error };

  // Keyed by client, matching the files convention — the item association
  // lives on the row, and the separate bucket is what isolates review media
  // from client deliverables.
  const storagePath = buildStoragePath(itemCheck.item.client_id, trimmedName);

  try {
    const { signedUrl } = await createSignedUploadUrl(
      storagePath,
      CONTENT_ASSETS_BUCKET
    );
    return { ok: true, data: { signedUrl, storagePath } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start upload",
    };
  }
}

// ---------------------------------------------------------------------------
// Photo assets — step 2: verify the object landed, then insert the row
// ---------------------------------------------------------------------------

export interface FinalizeContentAssetInput {
  itemId: string;
  storagePath: string;
}

export async function finalizeContentAssetAction(
  input: FinalizeContentAssetInput
): Promise<ActionResult<ContentAssetRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.storagePath) return { ok: false, error: "Missing storage path" };

  const itemCheck = await loadItem(input.itemId);
  if (!itemCheck.ok) return { ok: false, error: itemCheck.error };
  const { item } = itemCheck;

  // The path is minted server-side as `{clientId}/...`; reject a caller that
  // tampered with the prefix to write into another client's folder.
  if (!input.storagePath.startsWith(`${item.client_id}/`)) {
    return { ok: false, error: "Storage path does not match client" };
  }

  let sizeBytes: number;
  try {
    const meta = await readUploadedObjectMetadata(
      input.storagePath,
      CONTENT_ASSETS_BUCKET
    );
    sizeBytes = meta.sizeBytes;
  } catch {
    return { ok: false, error: "Upload did not complete" };
  }

  const supabase = getSupabaseServiceClient();

  let nextPosition: number;
  try {
    nextPosition = await nextAssetPosition(item.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }

  const { data, error } = await supabase
    .from("content_assets")
    .insert({
      content_item_id: item.id,
      position: nextPosition,
      kind: "image",
      provider: "supabase",
      external_id: input.storagePath,
      status: "ready",
      bytes: sizeBytes,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Another photo just took that slot — try again",
      };
    }
    return { ok: false, error: error?.message ?? "Failed to save photo" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: data as ContentAssetRecord };
}

// ---------------------------------------------------------------------------
// Video assets — step 1: mint the tus upload AND the row, together
//
// This is the one place the video path deliberately diverges from the photo
// path above, and the divergence is the whole design.
//
// A photo mints a signed URL and persists NOTHING. An abandoned PUT leaves no
// row and no object, because Supabase never sees bytes that were not sent.
//
// Video inverts that. Cloudflare accepts the upload directly from the browser
// (spec §3.6), so by the time our server is asked to record anything, the
// video is already stored and already billing. If that record then fails — a
// dropped connection on the finalize call, a serverless timeout, a closed
// laptop — the video is in Stream storage permanently with no row anywhere
// pointing at it. Nothing lists it, nothing reconciles it, nothing errors.
// That is spec §3.5c's silent leak, and it is the only failure mode in this
// feature with no recovery path at all.
//
// So the row is written HERE, at mint, before a single byte moves. Postgres
// becomes the record of every Stream video this app has ever created, which
// is the property that makes every other failure recoverable.
//
// Two consequences, both accepted deliberately:
//   - A failed or abandoned upload holds its carousel position. That is
//     visible in the panel as a processing tile and removable from there, so
//     it is a nuisance rather than a leak.
//   - A mint whose upload never starts leaves a `pendingupload` video. That
//     one is self-healing: Cloudflare releases the duration reservation when
//     the upload link expires.
// ---------------------------------------------------------------------------

export interface CreateContentVideoUploadInput {
  itemId: string;
  /**
   * Exact byte length of the file. Required, not optional: tus fixes
   * `Upload-Length` at creation time and Cloudflare sizes the reservation
   * from it.
   */
  sizeBytes: number;
}

export interface ContentVideoUploadTicket {
  /** tus endpoint the browser PATCHes chunks to. */
  uploadUrl: string;
  /** Cloudflare Stream UID, already persisted as the row's external_id. */
  uid: string;
  /** The `content_assets` row minted alongside it. Finalize needs this. */
  assetId: string;
}

export async function createContentVideoUploadAction(
  input: CreateContentVideoUploadInput
): Promise<ActionResult<ContentVideoUploadTicket>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const { sizeBytes } = input;
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "That file appears to be empty" };
  }
  if (sizeBytes > MAX_VIDEO_BYTES) {
    return { ok: false, error: "Video is larger than 500 MB." };
  }

  const itemCheck = await loadItem(input.itemId);
  if (!itemCheck.ok) return { ok: false, error: itemCheck.error };
  const { item } = itemCheck;

  // Read the slot BEFORE minting. A mint that we then cannot record is the
  // expensive direction, so every cheap failure is spent first.
  let nextPosition: number;
  try {
    nextPosition = await nextAssetPosition(item.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }

  let upload: { uploadUrl: string; uid: string };
  try {
    upload = await createResumableUploadUrl(sizeBytes);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start upload",
    };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .insert({
      content_item_id: item.id,
      position: nextPosition,
      kind: "video",
      provider: "stream",
      external_id: upload.uid,
      // Not 'ready'. The upload has not happened, and even once it has,
      // playability is a separate later event (spec §3.5b). The transition
      // out of this state is slice 2.4's polling.
      status: "processing",
      // The DECLARED size, so the row is never sizeless. Finalize overwrites
      // it with Cloudflare's measured size once that exists.
      bytes: sizeBytes,
    })
    .select("*")
    .single();

  if (error || !data) {
    // The row is what makes the video findable, so a failure here means the
    // UID is about to be forgotten. Nothing has been uploaded yet, so the
    // reservation would expire on its own — but taking the video out now is
    // free and removes the only case where a minted UID goes unrecorded.
    //
    // This is the ONE place a throw from deleteVideo is logged instead of
    // surfaced, and it is not the pattern lib/stream.ts warns against: there
    // is no row here to protect, nothing was uploaded, and the useful message
    // for Kelsey is the insert failure, not a cleanup detail.
    try {
      await deleteVideo(upload.uid);
    } catch (cleanupErr) {
      console.error(
        "stream mint cleanup failed; video left pending",
        upload.uid,
        cleanupErr
      );
    }

    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "Another asset just took that slot — try again",
      };
    }
    return { ok: false, error: error?.message ?? "Failed to start video" };
  }

  revalidatePath(CONTENT_PATH);
  return {
    ok: true,
    data: {
      uploadUrl: upload.uploadUrl,
      uid: upload.uid,
      assetId: (data as ContentAssetRecord).id,
    },
  };
}

// ---------------------------------------------------------------------------
// Video assets — step 2: finalize
//
// Called once tus reports the last chunk accepted. It does NOT insert; the
// row has existed since the mint. All it does is ask Cloudflare what it now
// knows about the video and write that onto the row.
//
// Expect this to leave the row on 'processing' most of the time. Upload
// completion and playability are separate events (spec §3.5b) and encoding
// starts only after the last byte lands, so a call made seconds later will
// usually see `queued` or `inprogress`. That is correct and not a failure —
// whatever state Cloudflare reports is written verbatim. The polling that
// catches the LATER transition to ready belongs to slice 2.4.
// ---------------------------------------------------------------------------

export async function finalizeContentVideoAssetAction(
  assetId: string
): Promise<ActionResult<ContentAssetRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!assetId) return { ok: false, error: "Missing asset id" };

  const supabase = getSupabaseServiceClient();
  const { data: assetRow, error: loadErr } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  const asset = assetRow as ContentAssetRecord | null;
  if (!asset) return { ok: false, error: "Asset not found" };
  if (asset.provider !== "stream") {
    return { ok: false, error: "That asset is not a video" };
  }

  let status: Awaited<ReturnType<typeof getVideoStatus>>;
  try {
    status = await getVideoStatus(asset.external_id);
  } catch (err) {
    // The bytes are safe and the row still points at them, so this is a
    // cosmetic failure, not a lost upload. Say so plainly — an alarming
    // message here would push Kelsey into re-uploading a video that is
    // already stored, which claims a second slot and bills twice.
    return {
      ok: false,
      error: `The video uploaded, but its status could not be read yet. It stays in the post and will catch up. (${
        err instanceof Error ? err.message : "unknown error"
      })`,
    };
  }

  const { data, error } = await supabase
    .from("content_assets")
    .update({
      status: status.status,
      duration_seconds: status.durationSeconds,
      width: status.width,
      height: status.height,
      // Cloudflare's measured size when it has one; otherwise keep the size
      // declared at mint rather than blanking a column that was already right.
      bytes: status.sizeBytes ?? asset.bytes,
    })
    .eq("id", assetId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to save video" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: data as ContentAssetRecord };
}

// ---------------------------------------------------------------------------
// Assets — read + delete (photos and videos)
// ---------------------------------------------------------------------------

export interface AssetPreview {
  id: string;
  position: number;
  kind: "video" | "image";
  status: "processing" | "ready" | "failed";
  /**
   * Signed image URL, or null when there is no still to show.
   *
   * Null for every Stream video: a thumbnail needs a signed playback token
   * and a customer-subdomain URL, which is slice 2.4's surface, not this one.
   * A null here is a PLACEHOLDER instruction, never an error — the tile still
   * renders, carrying `kind` and `status` instead of an image.
   */
  url: string | null;
}

/**
 * Previews for one item's live assets, minted on panel open rather than for
 * every asset on the page. The list view shows an asset count, so a month of
 * posts costs zero signed-URL calls until Kelsey opens an item.
 *
 * Every live asset yields a tile, including Stream rows that have no image.
 * Filtering those out (the pre-2.3 behaviour) would make an uploaded video
 * INVISIBLE in the panel: the row exists, the slot is taken, and nothing on
 * screen says so — which reads as a lost upload and invites a re-upload into
 * a position that is already claimed.
 */
export async function fetchContentAssetPreviewsAction(
  itemId: string
): Promise<ActionResult<AssetPreview[]>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .eq("content_item_id", itemId)
    .is("replaced_at", null)
    .order("position", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const assets = (data ?? []) as ContentAssetRecord[];
  const previews: AssetPreview[] = [];
  for (const asset of assets) {
    const base = {
      id: asset.id,
      position: asset.position,
      kind: asset.kind,
      status: asset.status,
    };

    if (asset.provider !== "supabase") {
      previews.push({ ...base, url: null });
      continue;
    }

    try {
      const url = await createSignedDownloadUrl(
        asset.external_id,
        `photo-${asset.position + 1}`,
        CONTENT_ASSETS_BUCKET
      );
      previews.push({ ...base, url });
    } catch {
      // A missing object shouldn't blank the whole strip. The tile is still
      // emitted with a null url so the slot stays accounted for and remains
      // deletable — dropping it entirely would hide a broken asset.
      previews.push({ ...base, url: null });
    }
  }
  return { ok: true, data: previews };
}

export async function deleteContentAssetAction(
  assetId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = getSupabaseServiceClient();
  const { data, error: loadErr } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  const asset = data as ContentAssetRecord | null;
  if (!asset) return { ok: false, error: "Asset not found" };

  // Provider decides the ORDER, not just the cleanup call.
  //
  //   supabase → row first, object swept after, failures logged. An orphaned
  //     object costs nothing on a flat-rate bucket.
  //   stream   → video first, row only once Cloudflare confirms. The UID on
  //     this row is the only thing in existence that points at that video
  //     (spec §3.5c), so losing the row before the video is deleted bills
  //     storage forever with no way to find it.
  //
  // This runs for status='processing' rows too. A video that was uploaded but
  // has not finished encoding is fully stored and fully billed; so is one
  // whose upload was abandoned partway. Skipping the delete because the asset
  // "was not ready" is exactly how the leak happens.
  if (asset.provider === "stream") {
    const streamSweep = await deleteStreamVideos([asset.external_id]);
    if (!streamSweep.ok) return { ok: false, error: streamSweep.error };
  }

  const { error } = await supabase
    .from("content_assets")
    .delete()
    .eq("id", assetId);
  if (error) return { ok: false, error: error.message };

  if (asset.provider === "supabase") {
    await sweepStorageObjects([asset.external_id]);
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}
