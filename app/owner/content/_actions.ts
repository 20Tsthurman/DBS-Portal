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
import { combineDateAndTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import type { ActionResult } from "@/lib/actions";

const CONTENT_PATH = "/owner/content";
const MAX_FILENAME_LENGTH = 255;
const MAX_CAPTION_LENGTH = 5000;

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
 * skipped — deleting those is Cloudflare's API, not storage, and no such rows
 * exist yet.
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

  // Append after the current last live asset. `position` is 0-based, so an
  // item with no assets starts at 0. Two concurrent finalizes could still
  // pick the same slot — the partial unique index rejects the loser rather
  // than silently producing two assets at one carousel position.
  const { data: lastRows, error: lastErr } = await supabase
    .from("content_assets")
    .select("position")
    .eq("content_item_id", item.id)
    .is("replaced_at", null)
    .order("position", { ascending: false })
    .limit(1);
  if (lastErr) return { ok: false, error: lastErr.message };
  const last = (lastRows ?? []) as Array<{ position: number }>;
  const nextPosition = last.length > 0 ? last[0].position + 1 : 0;

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
// Photo assets — read + delete
// ---------------------------------------------------------------------------

export interface AssetPreview {
  id: string;
  position: number;
  url: string;
}

/**
 * Signed preview URLs for one item's live assets, minted on panel open rather
 * than for every asset on the page. The list view shows a photo count, so a
 * month of posts costs zero signed-URL calls until Kelsey opens an item.
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
    if (asset.provider !== "supabase") continue;
    try {
      const url = await createSignedDownloadUrl(
        asset.external_id,
        `photo-${asset.position + 1}`,
        CONTENT_ASSETS_BUCKET
      );
      previews.push({ id: asset.id, position: asset.position, url });
    } catch {
      // A missing object shouldn't blank the whole strip — skip this one.
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
  if (!asset) return { ok: false, error: "Photo not found" };

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
