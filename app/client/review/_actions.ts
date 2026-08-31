"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentClient } from "@/lib/currentClient";
import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentCycleRecord,
  type ContentItemRecord,
} from "@/lib/supabase";
import { createPlaybackUrls } from "@/lib/stream";
import type { ActionResult } from "@/lib/actions";

const REVIEW_PATH = "/client/review";

/**
 * The client's two write/mint paths on the review surface.
 *
 * AUTHORIZATION IS ENTIRELY IN THIS FILE. There are no RLS policies and no
 * browser-side Supabase client anywhere in the project, so every guard is the
 * code below. Both patterns from the integration audit appear here, each where
 * it fits:
 *
 *   Approve  - Pattern A. `client_id` is a condition of the UPDATE itself, so
 *              a mismatched item cannot be written even in the gap between a
 *              read and a write.
 *   Playback - Pattern B. `content_assets` carries no `client_id`, so there is
 *              nothing to bake in: the asset is fetched, its item is fetched,
 *              and the ids are compared before a token is minted.
 */

/**
 * Approve one post (spec 5.3), behind the light confirmation dialog.
 *
 * Irreversible by design: there is no un-approve on the client side, which is
 * exactly why the dialog exists.
 *
 * Conditions are enforced in the UPDATE itself rather than checked first and
 * written after:
 *
 *   id         - the post asked for
 *   client_id  - theirs (Pattern A)
 *   status     - still awaiting them; an already-approved or already-sent post
 *                matches nothing, so a double-submit is a no-op instead of a
 *                second write that moves `approved_at`
 *
 * The cycle's release state is read separately, because it lives on another
 * table.
 *
 * `approved_by` stores the client's id, not their name. The only thing any
 * consumer asks of this column is whether it equals the literal 'auto' that
 * the Phase 7 deadline sweep writes (spec 3.9); everything else has to say
 * WHO, which a uuid does unambiguously and a display name does not. It is
 * never rendered - the deck's approved state says "You approved this post" and
 * names nobody.
 */
export async function approveContentItemAction(
  itemId: string
): Promise<ActionResult> {
  let client;
  try {
    client = await requireCurrentClient();
  } catch {
    return { ok: false, error: "Not signed in" };
  }

  if (!itemId) return { ok: false, error: "Missing post id" };

  const supabase = getSupabaseServiceClient();

  // The item, constrained to this client. A miss here is "not found" whether
  // the post does not exist or belongs to someone else.
  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("id, cycle_id, status")
    .eq("id", itemId)
    .eq("client_id", client.id)
    .maybeSingle();
  if (itemError) return { ok: false, error: itemError.message };
  const item = itemData as Pick<
    ContentItemRecord,
    "id" | "cycle_id" | "status"
  > | null;
  if (!item) return { ok: false, error: "Post not found" };

  // Release state. A client owns their unreleased posts too, so ownership
  // alone would let a stale tab approve a month Kelsey has pulled back.
  const { data: cycleData, error: cycleError } = await supabase
    .from("content_cycles")
    .select("status")
    .eq("id", item.cycle_id)
    .eq("client_id", client.id)
    .maybeSingle();
  if (cycleError) return { ok: false, error: cycleError.message };
  const cycle = cycleData as Pick<ContentCycleRecord, "status"> | null;
  if (!cycle || cycle.status !== "in_review") {
    return { ok: false, error: "This month is not open for review" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("content_items")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: client.id,
    })
    .eq("id", itemId)
    .eq("client_id", client.id)
    .eq("status", "in_review")
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated) {
    // Matched nothing: the post was already acted on, here or in another tab.
    return { ok: false, error: "This post has already been reviewed" };
  }

  revalidatePath(REVIEW_PATH);
  revalidatePath(`${REVIEW_PATH}/${itemId}`);
  return { ok: true };
}

/**
 * Mint a signed player URL for one video, at the moment the client presses
 * play (spec 3.5a).
 *
 * PATTERN B, VERBATIM - the shape the audit named for exactly this call, and
 * the one `lib/stream.ts` demands in its own docblocks: "handing it a UID is
 * enough to unlock that video for an hour", so ownership is established here
 * before `createPlaybackUrls` is ever reached.
 *
 * Minted per press rather than per page load so the token is always seconds
 * old when playback starts. A one-hour token minted at render would expand
 * into a silently dead frame on a tab left open through an afternoon.
 */
export async function createReviewPlaybackAction(
  assetId: string
): Promise<ActionResult<{ iframeUrl: string }>> {
  let client;
  try {
    client = await requireCurrentClient();
  } catch {
    return { ok: false, error: "Not signed in" };
  }

  if (!assetId) return { ok: false, error: "Missing video id" };

  const supabase = getSupabaseServiceClient();

  const { data: assetData, error: assetError } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle();
  if (assetError) return { ok: false, error: assetError.message };
  const asset = assetData as ContentAssetRecord | null;
  if (!asset) return { ok: false, error: "Video not found" };

  // Fetch, then compare. This is the step that makes the mint below safe.
  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("client_id, cycle_id")
    .eq("id", asset.content_item_id)
    .maybeSingle();
  if (itemError) return { ok: false, error: itemError.message };
  const item = itemData as Pick<
    ContentItemRecord,
    "client_id" | "cycle_id"
  > | null;
  // Identical answer for a missing item and someone else's item.
  if (!item || item.client_id !== client.id) {
    return { ok: false, error: "Video not found" };
  }

  const { data: cycleData, error: cycleError } = await supabase
    .from("content_cycles")
    .select("status")
    .eq("id", item.cycle_id)
    .maybeSingle();
  if (cycleError) return { ok: false, error: cycleError.message };
  const cycle = cycleData as Pick<ContentCycleRecord, "status"> | null;
  if (!cycle || cycle.status !== "in_review") {
    return { ok: false, error: "This month is not open for review" };
  }

  if (asset.provider !== "stream") {
    return { ok: false, error: "That asset is not a video" };
  }
  if (asset.status !== "ready") {
    // The client is shown the deck's media-error copy, never this string - a
    // transcode state is not something to explain to them.
    return { ok: false, error: "That video is not ready" };
  }

  try {
    return {
      ok: true,
      data: { iframeUrl: createPlaybackUrls(asset.external_id).iframeUrl },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start playback",
    };
  }
}
