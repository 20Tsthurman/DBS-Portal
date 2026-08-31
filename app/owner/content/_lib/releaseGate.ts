import {
  getSupabaseServiceClient,
  type ContentCycleRecord,
} from "@/lib/supabase";

/**
 * SERVER ONLY. The Release gate (spec §4.2): the set of conditions that must
 * hold before a month becomes visible to a client.
 *
 * THIS MODULE RUNS ITS OWN QUERIES, ALWAYS. It never accepts items or assets
 * from a caller, and that is the whole point of it being a module rather than
 * a few lines inside the action.
 *
 * The reason, carried forward from Phase 3 and restated in the build plan
 * (slice 4.1): `ContentBoard` holds the open slide-over as a SNAPSHOT captured
 * at open time, and `ItemFormPanel`'s asset-status poll deliberately does not
 * call `router.refresh()` on a transcode transition (see its comment at the
 * end of `refreshAssetStatuses`) — so neither the panel's copy of an item nor
 * the board's `items` prop is refreshed when a video turns ready. Both drift,
 * in both directions: a video that finished encoding after the page rendered
 * still reads 'processing', and a row deleted elsewhere still reads present.
 *
 * A gate fed from either would let Release fire on a cycle that is not ready,
 * or refuse one that is. So this asks Postgres at the moment of the decision.
 * The button state that Kelsey sees is a hint computed from a server render;
 * this function is the authority, and it is re-run inside the action after the
 * press.
 */

export type ReleaseGateResult = { ok: true } | { ok: false; reason: string };

/** "1 post" / "3 posts" — owner-facing, so no copy-deck constraint applies. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Evaluate every release condition for one cycle, in the order Kelsey can act
 * on them: the things she sets, then the things she has to add, then the
 * things she has to wait for. Only the first blocker is reported — a list of
 * five problems reads as a wall, and fixing the first usually reveals whether
 * the rest are real.
 */
export async function evaluateReleaseGate(
  cycle: ContentCycleRecord
): Promise<ReleaseGateResult> {
  // 1. The deadline. Required at Release by decision (2026-08-30): the client
  //    copy states it as a certainty in three places — the queue's deadline
  //    card, both of its lines, and the release email's second body line — and
  //    no string exists for a released month without one.
  if (!cycle.revision_deadline) {
    return { ok: false, reason: "Set a review deadline before releasing." };
  }
  // A deadline already in the past would be swept to `locked` by the Phase 7
  // cron on its next run, auto-approving a month the client never opened.
  // Blocked here rather than allowed and then explained.
  if (new Date(cycle.revision_deadline).getTime() <= Date.now()) {
    return {
      ok: false,
      reason:
        "The review deadline has already passed. Set a later one before releasing.",
    };
  }

  const supabase = getSupabaseServiceClient();

  const { data: itemRows, error: itemError } = await supabase
    .from("content_items")
    .select("id")
    .eq("cycle_id", cycle.id);
  if (itemError) throw new Error(itemError.message);

  const itemIds = (itemRows ?? []).map((row) => (row as { id: string }).id);

  // 2. An empty month passes the asset check vacuously — there are no assets
  //    to be un-ready — and would release a queue reading "0 posts are ready
  //    for your review." Blocked on its own terms.
  if (itemIds.length === 0) {
    return { ok: false, reason: "There are no posts in this month yet." };
  }

  // Every LIVE asset, not just the un-ready ones: the "post has no media at
  // all" check below needs the full set, and one query answers both.
  //
  // `replaced_at is null` is mandatory. From Phase 6 on, every accepted
  // revision leaves a superseded row behind, and without this filter those
  // rows would block Release on the cycle forever.
  const { data: assetRows, error: assetError } = await supabase
    .from("content_assets")
    .select("content_item_id, status")
    .in("content_item_id", itemIds)
    .is("replaced_at", null);
  if (assetError) throw new Error(assetError.message);

  const assets = (assetRows ?? []) as Array<{
    content_item_id: string;
    status: string;
  }>;

  // 3. A post with no media is the same failure as a dead player — the client
  //    opens it and there is nothing there. Spec §4.2 only names transcoding,
  //    but the reason it gives ("otherwise clients open dead players") covers
  //    this case identically.
  const itemsWithMedia = new Set(assets.map((a) => a.content_item_id));
  const withoutMedia = itemIds.filter((id) => !itemsWithMedia.has(id)).length;
  if (withoutMedia > 0) {
    return {
      ok: false,
      reason: `${count(withoutMedia, "post has", "posts have")} no photo or video yet.`,
    };
  }

  // 4. Failed before processing: a failed encode needs Kelsey to do something,
  //    a processing one needs her to wait, and telling her to wait for a clip
  //    that will never finish is the worse error.
  const failed = assets.filter((a) => a.status === "failed").length;
  if (failed > 0) {
    return {
      ok: false,
      reason: `${count(failed, "video", "videos")} failed to encode. Remove ${
        failed === 1 ? "it" : "them"
      } or upload a new version.`,
    };
  }

  const processing = assets.filter((a) => a.status === "processing").length;
  if (processing > 0) {
    return {
      ok: false,
      reason: `${count(processing, "video is", "videos are")} still processing.`,
    };
  }

  return { ok: true };
}
