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

  return evaluateAssetReadiness(itemIds);
}

/**
 * Steps 3 and 4 of the release gate over an explicit set of posts: every one
 * has media, and no live video is failed or still processing. Shared with the
 * re-release gate, which runs it over only the posts being sent back rather
 * than the whole month.
 */
async function evaluateAssetReadiness(
  itemIds: string[]
): Promise<ReleaseGateResult> {
  if (itemIds.length === 0) return { ok: true };
  const supabase = getSupabaseServiceClient();

  // Every LIVE asset, not just the un-ready ones: the "post has no media at
  // all" check below needs the full set, and one query answers both.
  //
  // `replaced_at is null` is mandatory. From Phase 6 on, every accepted
  // revision leaves a superseded row behind, and without this filter those
  // rows would block Release on the cycle forever. It also hides a STAGED
  // replacement (born with `replaced_at` set) — correctly, since the client
  // never sees one.
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

// ---------------------------------------------------------------------------
// Re-release (spec §4.8)
// ---------------------------------------------------------------------------

/** One post the re-release will send back, and the accepted round it closes. */
export interface RereleasePromotion {
  itemId: string;
  /** The accepted round's number; the post's `current_round` becomes this + 1. */
  roundNumber: number;
}

/**
 * `reason: null` on a blocked gate means IDLE — nothing is waiting on Kelsey
 * and nothing is ready to send back. That is the normal state of a released
 * month and not worth a sentence on the cycle bar; the button simply stays
 * disabled. A string is an actionable blocker.
 */
export type RereleaseGateResult =
  | { ok: true; promotions: RereleasePromotion[] }
  | { ok: false; reason: string | null };

/**
 * Evaluate every re-release condition for one cycle (spec §4.8: "when she is
 * done, she re-releases the cycle. This opens the next round").
 *
 * THE BATCH GATE (approved 2026-08-31): a re-release sends back EVERY post
 * whose latest submitted request was accepted, or nothing. No partial
 * re-release — three separate "Kelsey updated your posts" emails for one round
 * is exactly the trickle the round structure exists to prevent. So: at least
 * one accepted request to send back, and no submitted request still open.
 * Denied requests are final and stay where they are (deny writes nothing to
 * `content_items`); approved posts and drafts are never touched.
 *
 * "Latest submitted round per post" is the derivation the client surface
 * already uses (`fetchMyDeniedItemIds`), under the same standing rule: rounds
 * are read with `submitted_at IS NOT NULL`, always — an unsubmitted row is
 * debris from a failed client submit, never data.
 *
 * THE DEADLINE CHECK IS ACTIONABLE, NOT A DEAD END (ruling 2026-09-02). On a
 * first release a past deadline means nobody saw anything. On a re-release the
 * client already reviewed, and the deadline may have passed while Kelsey
 * worked — refusing to send back accepted work because her own turnaround ran
 * long would be backwards. But a re-release INTO a past deadline opens a round
 * the Phase 7 sweep locks on its next run, so it is still refused; the message
 * names the fix (edit the cycle, extend, re-release) instead of just saying
 * no, because she cannot extend from where the button is.
 *
 * ASSET READINESS IS CHECKED ON THE POSTS GOING BACK, ONLY. Owner-side asset
 * add and delete are not status-gated, so a returning post can have no media
 * or a processing video — the same dead-player failure the release gate
 * exists for. A draft Kelsey parked for a later unrelease-add-release is not
 * going back and must not block this.
 *
 * Like `evaluateReleaseGate`, this runs its own queries and is re-run inside
 * the action after the press; whatever the button looked like is a hint.
 */
export async function evaluateRereleaseGate(
  cycle: ContentCycleRecord
): Promise<RereleaseGateResult> {
  const supabase = getSupabaseServiceClient();

  const { data: itemRows, error: itemError } = await supabase
    .from("content_items")
    .select("id, status")
    .eq("cycle_id", cycle.id);
  if (itemError) throw new Error(itemError.message);
  const items = (itemRows ?? []) as Array<{ id: string; status: string }>;
  if (items.length === 0) return { ok: false, reason: null };

  const { data: roundRows, error: roundError } = await supabase
    .from("revision_rounds")
    .select("content_item_id, round_number, status")
    .in(
      "content_item_id",
      items.map((item) => item.id)
    )
    .not("submitted_at", "is", null);
  if (roundError) throw new Error(roundError.message);

  const latest = new Map<string, { roundNumber: number; status: string }>();
  for (const raw of (roundRows ?? []) as Array<{
    content_item_id: string;
    round_number: number;
    status: string;
  }>) {
    const current = latest.get(raw.content_item_id);
    if (!current || raw.round_number > current.roundNumber) {
      latest.set(raw.content_item_id, {
        roundNumber: raw.round_number,
        status: raw.status,
      });
    }
  }

  let open = 0;
  const promotions: RereleasePromotion[] = [];
  for (const item of items) {
    // Only a post the client sent back, and is still waiting on, can go back.
    // An 'in_review' post at round 2 also has an addressed latest round — it
    // was sent back already — and an approved one is settled either way.
    if (item.status !== "changes_requested") continue;
    const round = latest.get(item.id);
    if (!round) continue;
    if (round.status === "open") {
      open += 1;
    } else if (round.status === "addressed") {
      promotions.push({ itemId: item.id, roundNumber: round.roundNumber });
    }
    // 'denied' is final: it neither blocks nor promotes.
  }

  // 1. Idle — nothing to send back and nothing waiting. Silent.
  if (promotions.length === 0 && open === 0) {
    return { ok: false, reason: null };
  }

  // 2. The deadline. A thing she sets, so it is the first blocker reported.
  //    Nullable here: the cycle form allows clearing it on a released month.
  if (!cycle.revision_deadline) {
    return {
      ok: false,
      reason: "Set a review deadline before sending the updates back.",
    };
  }
  if (new Date(cycle.revision_deadline).getTime() <= Date.now()) {
    return {
      ok: false,
      reason:
        "The review deadline has passed. Extend it under Edit cycle before sending the updates back.",
    };
  }

  // 3. Requests still waiting on her. All or nothing.
  if (open > 0) {
    return {
      ok: false,
      reason: `${count(open, "request is", "requests are")} still waiting on you. Accept or deny each one before re-releasing.`,
    };
  }

  // 4. The posts going back must be playable.
  const readiness = await evaluateAssetReadiness(
    promotions.map((promotion) => promotion.itemId)
  );
  if (!readiness.ok) return readiness;

  return { ok: true, promotions };
}
