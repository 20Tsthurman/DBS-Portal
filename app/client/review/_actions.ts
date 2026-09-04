"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentClient } from "@/lib/currentClient";
import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentCycleRecord,
  type ContentItemRecord,
  type RevisionCategory,
  type RevisionRoundRecord,
} from "@/lib/supabase";
import { createPlaybackUrls } from "@/lib/stream";
import { roundChargeColumns } from "@/lib/revisionBilling";
import type { ActionResult } from "@/lib/actions";
import { CATEGORY_ORDER } from "./_lib/copy";
import {
  consentMatches,
  isValidConsent,
  TERMS_CHANGED_ERROR,
  type ChangeRequestConsent,
} from "./_lib/consent";
import { resolveMyRoundBilling } from "./_lib/queries";

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

// ---------------------------------------------------------------------------
// Submit a change request — Phase 5; the charge decision, Phase 8
// ---------------------------------------------------------------------------

/** One selected category and what the client wrote for it. */
export interface ChangeRequestCategoryInput {
  category: RevisionCategory;
  body: string;
}

/** One "note on a moment": a scrubber position and what they wrote there. */
export interface ChangeRequestMomentInput {
  seconds: number;
  body: string;
}

export interface ChangeRequestInput {
  itemId: string;
  categories: ChangeRequestCategoryInput[];
  moments: ChangeRequestMomentInput[];
  /**
   * What the dialog showed: no charge, or a charge of exactly this amount.
   * The commit writes a charge only when its own computation matches this
   * (`consentMatches`) — the refuse rule, approved 2026-09-04.
   */
  consent: ChangeRequestConsent;
}

/**
 * Generous ceiling per note body. The form gates on non-empty; this guards
 * the write against a pasted novel, not against normal use.
 */
const MAX_NOTE_BODY_CHARS = 2000;
/** More moments than seconds in a max-length clip is nonsense input. */
const MAX_MOMENT_NOTES = 20;
/** Scrubber positions beyond any permitted clip length (lib/stream.ts caps
 * uploads at 120s) are nonsense input, with margin for the cap moving. */
const MAX_MOMENT_SECONDS = 7200;

const VALID_CATEGORIES: ReadonlySet<string> = new Set(CATEGORY_ORDER);

/**
 * Pure validation, separated so the write sequence below reads as only the
 * write sequence. Returns the normalized (trimmed) payload or an error
 * string. Error strings here are developer-facing: the client UI maps every
 * failure to the deck's SEND_FAILED line.
 */
function validateChangeRequest(
  input: ChangeRequestInput
):
  | {
      ok: true;
      categories: ChangeRequestCategoryInput[];
      moments: ChangeRequestMomentInput[];
      consent: ChangeRequestConsent;
    }
  | { ok: false; error: string } {
  if (!input.itemId) return { ok: false, error: "Missing post id" };
  if (!Array.isArray(input.categories) || !Array.isArray(input.moments)) {
    return { ok: false, error: "Malformed request" };
  }
  if (!isValidConsent(input.consent)) {
    return { ok: false, error: "Malformed consent" };
  }
  if (input.categories.length === 0) {
    return { ok: false, error: "Pick at least one category" };
  }
  if (input.categories.length > CATEGORY_ORDER.length) {
    return { ok: false, error: "Too many categories" };
  }
  if (input.moments.length > MAX_MOMENT_NOTES) {
    return { ok: false, error: "Too many notes on moments" };
  }

  const seen = new Set<string>();
  const categories: ChangeRequestCategoryInput[] = [];
  for (const entry of input.categories) {
    if (!VALID_CATEGORIES.has(entry.category)) {
      return { ok: false, error: "Unknown category" };
    }
    if (seen.has(entry.category)) {
      return { ok: false, error: "Duplicate category" };
    }
    seen.add(entry.category);
    const body = (entry.body ?? "").trim();
    if (body.length === 0) {
      return { ok: false, error: "Every selected category needs a comment" };
    }
    if (body.length > MAX_NOTE_BODY_CHARS) {
      return { ok: false, error: "A comment is too long" };
    }
    categories.push({ category: entry.category, body });
  }

  const moments: ChangeRequestMomentInput[] = [];
  for (const entry of input.moments) {
    if (
      typeof entry.seconds !== "number" ||
      !Number.isFinite(entry.seconds) ||
      entry.seconds < 0 ||
      entry.seconds > MAX_MOMENT_SECONDS
    ) {
      return { ok: false, error: "A moment note has a bad timestamp" };
    }
    const body = (entry.body ?? "").trim();
    if (body.length === 0) {
      return { ok: false, error: "Every moment note needs a comment" };
    }
    if (body.length > MAX_NOTE_BODY_CHARS) {
      return { ok: false, error: "A moment note is too long" };
    }
    moments.push({ seconds: entry.seconds, body });
  }

  return { ok: true, categories, moments, consent: input.consent };
}

/**
 * Submit one item's change request: one `revision_rounds` row plus its
 * `revision_notes`, then the item flips `in_review -> changes_requested` and
 * is LOCKED to the client (spec §5.4 — the mechanism the whole design rests
 * on; there is no reopen, ever).
 *
 * ANY ROUND, AND THE CHARGE IS DECIDED AT THE COMMIT. The round number is the
 * item's `current_round`, which starts at 1 and is advanced only by Kelsey's
 * re-release (`rereleaseContentCycleAction`). What the round COSTS is decided
 * once, in step 3, by `computeRoundCharge` (lib/revisionBilling.ts) from the
 * cycle's settings as they stand — `included_rounds`, `extra_round_price`,
 * `billing_mode` — and, in per_round, whether another post already opened
 * this round. The answer is written onto the row as `is_billable` + `price`
 * in the same UPDATE that stamps `submitted_at`. That UPDATE is guarded on
 * `submitted_at IS NULL`, so it can never touch a round that was already
 * sent: every round submitted before Phase 8 keeps the false/null Phase 5
 * wrote, forever, because no consent dialog was ever shown for it (spec
 * §5.8). `price` is null on a free round, never 0 — 0 is reserved at the
 * cycle level to mean "billing off", and migration 019's CHECK enforces the
 * pairing either way.
 *
 * THE WRITE SEQUENCE RUNS WITHOUT A TRANSACTION — supabase-js has none and
 * the house bans DB functions — so the ordering is the safety mechanism.
 * `submitted_at` is the commit bit (migration 015 designed it as such):
 *
 *   1. find-or-create the round with `submitted_at` NULL   — invisible
 *   2. replace its notes                                    — invisible
 *   3. stamp `submitted_at` / `submitted_by` + the charge   — THE COMMIT
 *   4. flip the item to changes_requested                   — the lock
 *
 * Notes land before the commit bit, so Kelsey can never see a submitted
 * round with half its notes; the item flips last, so the client is never
 * locked out of a post whose feedback didn't fully land. Every step is
 * idempotent and a retry repairs any partial state: debris from a failed
 * attempt (an unsubmitted round, with or without notes) is reused and its
 * notes replaced wholesale — which also keeps SEND_FAILED's "nothing was
 * sent to Kelsey" honest, because unsubmitted rounds render nowhere (the
 * standing read rule in `_lib/queries.ts`).
 *
 * THE UNIQUE CONSTRAINT ON (content_item_id, round_number) IS THE BACKSTOP,
 * not the lock. A double-submit — two tabs, a retry after a timeout —
 * resolves to the already-submitted path, which repairs the item flip if
 * step 4 was the failure and reports SUCCESS: the client lands on Screen 5's
 * "Your notes are with Kelsey", which is what the deck already says about a
 * sent post. No raw constraint error ever reaches them.
 *
 * MOMENT NOTES are written with the constant category 'other' and their
 * `timestamp_seconds` set — `timestamp_seconds IS NOT NULL` is the
 * discriminator, per the 2026-08-31 decision documented on
 * `fetchMySubmittedRound`. They are accepted only when the item actually has
 * a live video asset (the deck's video-only rule, enforced server-side).
 */
export async function submitChangeRequestAction(
  input: ChangeRequestInput
): Promise<ActionResult> {
  let client;
  try {
    client = await requireCurrentClient();
  } catch {
    return { ok: false, error: "Not signed in" };
  }

  const parsed = validateChangeRequest(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { categories, moments, consent } = parsed;
  const itemId = input.itemId;

  const supabase = getSupabaseServiceClient();

  // The item, constrained to this client (Pattern A). Same silent miss for
  // missing and not-yours.
  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("id, cycle_id, status, current_round")
    .eq("id", itemId)
    .eq("client_id", client.id)
    .maybeSingle();
  if (itemError) return { ok: false, error: itemError.message };
  const item = itemData as Pick<
    ContentItemRecord,
    "id" | "cycle_id" | "status" | "current_round"
  > | null;
  if (!item || item.status === "draft") {
    return { ok: false, error: "Post not found" };
  }

  // Release state, exactly as the approve action reads it — plus the three
  // billing settings the commit decides the charge from. Read once, here, so
  // the price snapshotted in step 3 is the one this submission saw.
  const { data: cycleData, error: cycleError } = await supabase
    .from("content_cycles")
    .select("status, included_rounds, extra_round_price, billing_mode")
    .eq("id", item.cycle_id)
    .eq("client_id", client.id)
    .maybeSingle();
  if (cycleError) return { ok: false, error: cycleError.message };
  const cycle = cycleData as Pick<
    ContentCycleRecord,
    "status" | "included_rounds" | "extra_round_price" | "billing_mode"
  > | null;
  if (!cycle || cycle.status !== "in_review") {
    return { ok: false, error: "This month is not open for review" };
  }

  if (item.status === "approved" || item.status === "published") {
    return { ok: false, error: "This post has already been reviewed" };
  }

  // The deck's video-only rule for moments, enforced against the data rather
  // than trusted from the client.
  if (moments.length > 0) {
    const { data: videoData, error: videoError } = await supabase
      .from("content_assets")
      .select("id")
      .eq("content_item_id", itemId)
      .eq("kind", "video")
      .is("replaced_at", null)
      .limit(1);
    if (videoError) return { ok: false, error: videoError.message };
    if ((videoData ?? []).length === 0) {
      return { ok: false, error: "This post has no video for moment notes" };
    }
  }

  // --- Step 1: find-or-create the round, submitted_at NULL -----------------

  const { data: existingData, error: existingError } = await supabase
    .from("revision_rounds")
    .select("id, submitted_at")
    .eq("content_item_id", itemId)
    .eq("round_number", item.current_round)
    .maybeSingle();
  if (existingError) return { ok: false, error: existingError.message };
  let round = existingData as Pick<
    RevisionRoundRecord,
    "id" | "submitted_at"
  > | null;

  if (round?.submitted_at) {
    // Already sent — here or in another tab. Repair the item flip if that
    // was the step that failed last time, then report success: the client
    // lands on the "Your notes are with Kelsey" state either way.
    await lockItemAsChangesRequested(itemId, client.id);
    revalidateReviewPaths(itemId);
    return { ok: true };
  }

  if (!round) {
    const { data: insertedData, error: insertError } = await supabase
      .from("revision_rounds")
      .insert({
        content_item_id: itemId,
        round_number: item.current_round,
        // FREE AT BIRTH; the charge is decided at the commit (step 3). An
        // unsubmitted row is never a charge — it may be debris a later retry
        // reuses under different cycle settings — so the flag and the price
        // are written together with `submitted_at`, not here. Explicit rather
        // than the column default because false/null is also what every
        // round sent before Phase 8 carries permanently (see the docblock),
        // and the two should read as the same deliberate value.
        is_billable: false,
        price: null,
        status: "open",
      })
      .select("id, submitted_at")
      .maybeSingle();
    if (insertError) {
      // 23505: the unique constraint — a concurrent submit created the round
      // between our read and this insert. Re-read and fall through.
      if (insertError.code !== "23505") {
        return { ok: false, error: insertError.message };
      }
      const { data: racedData, error: racedError } = await supabase
        .from("revision_rounds")
        .select("id, submitted_at")
        .eq("content_item_id", itemId)
        .eq("round_number", item.current_round)
        .maybeSingle();
      if (racedError) return { ok: false, error: racedError.message };
      round = racedData as Pick<
        RevisionRoundRecord,
        "id" | "submitted_at"
      > | null;
      if (!round) return { ok: false, error: "Could not open the round" };
      if (round.submitted_at) {
        await lockItemAsChangesRequested(itemId, client.id);
        revalidateReviewPaths(itemId);
        return { ok: true };
      }
    } else {
      round = insertedData as Pick<
        RevisionRoundRecord,
        "id" | "submitted_at"
      > | null;
      if (!round) return { ok: false, error: "Could not open the round" };
    }
  } else {
    // Debris from a failed earlier attempt: reuse the row, replace its notes.
    const { error: clearError } = await supabase
      .from("revision_notes")
      .delete()
      .eq("round_id", round.id);
    if (clearError) return { ok: false, error: clearError.message };
  }

  // --- Step 2: the notes, in one batch --------------------------------------

  const roundId = round.id;
  const noteRows = [
    ...categories.map((entry) => ({
      round_id: roundId,
      category: entry.category,
      timestamp_seconds: null as number | null,
      body: entry.body,
    })),
    ...moments.map((entry) => ({
      round_id: roundId,
      // The constant category for moment notes — timestamp_seconds is the
      // discriminator (see fetchMySubmittedRound's standing rule).
      category: "other" as RevisionCategory,
      timestamp_seconds: entry.seconds,
      body: entry.body,
    })),
  ];

  const { error: notesError } = await supabase
    .from("revision_notes")
    .insert(noteRows);
  if (notesError) return { ok: false, error: notesError.message };

  // --- Step 3: the commit bit, carrying the charge decision -----------------

  // THE CHARGE IS DECIDED HERE, ONCE, and written in the same statement as
  // `submitted_at`, so a round is never sent with its price unsettled and a
  // debris row never carries a charge. `resolveMyRoundBilling` is the SAME
  // function the item page called to choose the dialog, over the same cycle
  // columns and the same opener read — done NOW, as late as possible, so the
  // window for a concurrent opener is the width of one UPDATE.
  //
  // What the two calls cannot share is the instant, and Kelsey can edit the
  // cycle between them. So the dialog's outcome travelled here as `consent`,
  // and the refuse rule (approved 2026-09-04) binds the write to it: a free
  // outcome is accepted under any consent, a charge only at exactly the
  // consented amount, and anything else is refused with nothing written —
  // the round is still unsubmitted debris, which the retry reuses, so
  // "nothing was sent" stays honest. The refusal is logged because it should
  // be rare: if it becomes common, prices are being edited mid-review.
  let billing;
  try {
    billing = await resolveMyRoundBilling(
      client.id,
      item.cycle_id,
      cycle,
      item.current_round
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not settle the charge",
    };
  }

  if (!consentMatches(consent, billing)) {
    const consented = consent.kind === "charge" ? consent.amount : "none";
    const computed = billing.kind === "charge" ? billing.price : billing.kind;
    console.error(
      `[review] charge refused: cycle ${item.cycle_id}, round ${item.current_round}, consented ${consented}, computed ${computed}`
    );
    return { ok: false, error: TERMS_CHANGED_ERROR };
  }

  const { error: commitError } = await supabase
    .from("revision_rounds")
    .update({
      submitted_at: new Date().toISOString(),
      submitted_by: client.id,
      // Migration 019's CHECK: the flag and the amount land together, or
      // neither does. Included and covered rows both write false/null — no
      // marker of any kind (lib/revisionBilling.ts, rule 2).
      ...roundChargeColumns(billing),
    })
    .eq("id", round.id)
    .is("submitted_at", null);
  if (commitError) return { ok: false, error: commitError.message };
  // Matching zero rows here means a concurrent submit already committed —
  // fine: one coherent note set won, and the lock below still applies.

  // --- Step 4: the lock ------------------------------------------------------

  const { error: lockError } = await lockItemAsChangesRequested(
    itemId,
    client.id
  );
  if (lockError) return { ok: false, error: lockError };

  revalidateReviewPaths(itemId);
  return { ok: true };
}

/**
 * The item flip, shared by the normal path and the double-submit repair.
 * Pattern A conditions: an item that is not this client's, or not awaiting
 * them, matches nothing — which for the repair caller is the expected case.
 */
async function lockItemAsChangesRequested(
  itemId: string,
  clientId: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("content_items")
    .update({ status: "changes_requested" })
    .eq("id", itemId)
    .eq("client_id", clientId)
    .eq("status", "in_review");
  return { error: error ? error.message : null };
}

function revalidateReviewPaths(itemId: string) {
  revalidatePath(REVIEW_PATH);
  revalidatePath(`${REVIEW_PATH}/${itemId}`);
}
