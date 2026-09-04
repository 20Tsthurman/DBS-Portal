"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentBillingMode,
  type ContentCycleRecord,
  type ContentItemRecord,
  type Platform,
  type PostFormat,
  type RevisionRoundRecord,
} from "@/lib/supabase";
import {
  CONTENT_ASSETS_BUCKET,
  buildStoragePath,
  createSignedUploadUrl,
  deleteStorageObject,
  readUploadedObjectMetadata,
} from "@/lib/storage";
import {
  createPlaybackUrls,
  createResumableUploadUrl,
  deleteVideo,
  describeStreamError,
  getVideoStatus,
} from "@/lib/stream";
import {
  buildAssetPreviews,
  type AssetPreview,
} from "@/app/owner/content/_lib/assetPreviews";
import { Resend } from "resend";
import {
  combineDateAndTimeInTimezone,
  monthNameForMonthKey,
  weekdayDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { resolveBaseUrl } from "@/lib/baseUrl";
import {
  buildContentReleaseEmailHtml,
  buildContentReleaseEmailSubject,
  buildContentRereleaseEmailHtml,
  buildContentRereleaseEmailSubject,
} from "@/lib/contentEmails";
import {
  evaluateReleaseGate,
  evaluateRereleaseGate,
} from "@/app/owner/content/_lib/releaseGate";
import {
  fetchLatestRevisionRequest,
  type RevisionRequestView,
} from "@/app/owner/content/_lib/revisionRequests";
import {
  fetchReplacementState,
  type ReplacementState,
} from "@/app/owner/content/_lib/replacementState";
import { lockCycle } from "@/app/owner/content/_lib/cycleLock";
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
/** Mirrors content_cycles_billing_mode_check (migration 019). */
const BILLING_MODES: ContentBillingMode[] = ["per_round", "per_item"];

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

/**
 * The wall-clock time a review deadline lands on, in PORTAL_TIMEZONE.
 *
 * Kelsey picks a DAY ("Review by Friday, September 25") and the client copy
 * reads that day as inclusive — "anything you haven't reviewed by then is
 * approved automatically". So the instant stored is the END of that day, not
 * its start. A deadline stored at 00:00 would expire a full day early and
 * auto-approve a month on the morning the client was told they still had.
 */
const DEADLINE_WALL_CLOCK = "23:59";

/**
 * A deadline date key -> the stored instant, or null for "not set yet".
 *
 * Deliberately NOT pinned to the cycle's month, which is the one way this
 * differs from `resolveScheduledFor`. A review deadline normally falls BEFORE
 * the content month — October's posts are reviewed in September — so the month
 * pin that protects `scheduled_for` would reject every correct value here.
 *
 * `combineDateAndTimeInTimezone` for the same reason it is used above: the
 * `new Date(y, m-1, d)` path reads the server's offset, which is UTC in
 * production (spec §3.9).
 */
function resolveRevisionDeadline(
  raw: string | null
): { ok: true; deadline: string | null } | { ok: false; error: string } {
  if (raw === null || raw.trim() === "") return { ok: true, deadline: null };
  const date = raw.trim();
  if (!DATE_RE.test(date)) return { ok: false, error: "Invalid review deadline" };
  return {
    ok: true,
    deadline: combineDateAndTimeInTimezone(
      date,
      DEADLINE_WALL_CLOCK
    ).toISOString(),
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
  /**
   * How a billable round is charged (migration 019). Stored whatever the
   * price is; it only has an effect once the price is above zero.
   */
  billingMode: ContentBillingMode;
  /** YYYY-MM-DD, or null for "not set yet". Required before Release. */
  revisionDeadline: string | null;
}

/**
 * The three billing settings share one validator across create and update, so
 * the two actions cannot drift on what a legal price or mode is. The price
 * accepts 0 — that is the documented "billing off" value — and the editor's
 * warning is what stands between Kelsey and a price her client never agreed
 * to; the server does not second-guess the agreement.
 */
function validateCycleBilling(input: {
  includedRounds: number;
  extraRoundPrice: number | null;
  billingMode: ContentBillingMode;
}): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(input.includedRounds) || input.includedRounds < 0) {
    return { ok: false, error: "Included rounds must be a whole number" };
  }
  if (input.extraRoundPrice !== null && !(input.extraRoundPrice >= 0)) {
    return { ok: false, error: "Extra round price must be zero or more" };
  }
  if (!BILLING_MODES.includes(input.billingMode)) {
    return { ok: false, error: "Invalid billing mode" };
  }
  return { ok: true };
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
  const billing = validateCycleBilling(input);
  if (!billing.ok) return { ok: false, error: billing.error };
  const deadline = resolveRevisionDeadline(input.revisionDeadline);
  if (!deadline.ok) return { ok: false, error: deadline.error };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .insert({
      client_id: input.clientId,
      month: `${input.monthKey}-01`,
      revision_deadline: deadline.deadline,
      included_rounds: input.includedRounds,
      extra_round_price: input.extraRoundPrice,
      billing_mode: input.billingMode,
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
  billingMode: ContentBillingMode;
  /** YYYY-MM-DD, or null to clear. Editable while `in_review` — see below. */
  revisionDeadline: string | null;
}

export async function updateContentCycleAction(
  input: UpdateContentCycleInput
): Promise<ActionResult<ContentCycleRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(input.cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };

  const billing = validateCycleBilling(input);
  if (!billing.ok) return { ok: false, error: billing.error };
  const deadline = resolveRevisionDeadline(input.revisionDeadline);
  if (!deadline.ok) return { ok: false, error: deadline.error };

  // Editing a RELEASED cycle is allowed here, and only the deadline field
  // makes that meaningful: spec §4.3 says extending is a single field change
  // that "does not require re-release, does not reset the cycle, and does not
  // affect any client progress". Nothing about this write touches item state,
  // so that property holds by construction.
  //
  // The billing settings are editable on a released cycle too, and that is
  // safe for the same reason the price snapshot exists: a round's charge is
  // decided once, at the client's commit, from the settings as they stand
  // then (lib/revisionBilling.ts). A change here reaches only rounds the
  // client has not sent yet — lowering the price or turning billing off
  // mid-month is the more-generous direction spec §6.1 allows, and raising it
  // never re-prices anything already sent.
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .update({
      revision_deadline: deadline.deadline,
      included_rounds: input.includedRounds,
      extra_round_price: input.extraRoundPrice,
      billing_mode: input.billingMode,
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
// Release / unrelease / re-release
//
// The first client-visible write in the whole feature. `content_cycles.status`
// is the switch: nothing under /client/review reads a cycle that is not
// 'in_review', so release and unrelease are the entire visibility boundary.
// Re-release (spec §4.8) is the third action here and deliberately NOT part of
// that boundary — it runs on a month that is already 'in_review' and never
// writes the cycle row.
// ---------------------------------------------------------------------------

/**
 * Make a month visible to its client (spec §4.2). Per client, per cycle, one
 * action — there is no per-post send and no partial release.
 *
 * A SECOND CALL AFTER AN UNRELEASE IS THIS SAME ACTION. Spec §4.4's recovery
 * path for a forgotten post is unrelease -> add the post -> release again, so
 * releasing a month that was released before is the ordinary path, not a
 * special case. What makes that safe is the item filter below. This is NOT
 * spec §4.8's re-release — sending accepted revisions back for the next round
 * while the cycle stays 'in_review' — which is `rereleaseContentCycleAction`
 * below and does not route through here or through unrelease.
 *
 * The gate is re-evaluated HERE, after the press, against its own queries.
 * Whatever the button looked like is a hint that may be seconds stale; this is
 * the decision. See `evaluateReleaseGate`.
 *
 * WRITE ORDER IS DELIBERATE: items first, cycle second. The two writes are not
 * in a transaction (the service client has no transaction API here), so one
 * can land without the other, and the two failure modes are not equal:
 *
 *   items then cycle  — a crash between them leaves items at 'in_review'
 *                       inside a 'drafting' cycle. The client sees nothing,
 *                       because visibility is the cycle's status. Kelsey
 *                       presses Release again and it completes.
 *   cycle then items  — a crash between them leaves a RELEASED cycle whose
 *                       posts are all still 'draft'. The client gets the email
 *                       and opens a queue with nothing in it.
 *
 * The first is invisible and self-healing. The second is the bad one, in front
 * of a client. So: items first.
 */
export async function releaseContentCycleAction(
  cycleId: string
): Promise<ActionResult<{ releasedItemCount: number }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };
  const { cycle } = cycleCheck;

  if (cycle.status === "in_review") {
    return { ok: false, error: "This month is already released." };
  }
  if (cycle.status === "locked") {
    return {
      ok: false,
      error: "This month is locked. Reviews are closed for it.",
    };
  }

  let gate;
  try {
    gate = await evaluateReleaseGate(cycle);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not check whether this month is ready to release",
    };
  }
  if (!gate.ok) return { ok: false, error: gate.reason };

  const supabase = getSupabaseServiceClient();

  // Only 'draft' items are promoted. Everything else is CLIENT PROGRESS and is
  // left exactly as it stands — an approved post stays approved across an
  // unrelease/re-release cycle, which is the property spec §4.4 depends on
  // ("submitted items remain submitted; the client sees one new item appear").
  //
  // It also means a post Kelsey adds to an already-released month stays
  // invisible until she releases again: it is created 'draft', and 'draft' is
  // what the client queue filters out.
  const { data: promoted, error: itemError } = await supabase
    .from("content_items")
    .update({ status: "in_review" })
    .eq("cycle_id", cycle.id)
    .eq("status", "draft")
    .select("id");
  if (itemError) {
    return { ok: false, error: itemError.message };
  }

  // Guarded on the status this action already read, so two concurrent presses
  // cannot both succeed — the second matches no row and is reported as the
  // already-released case rather than sending a second email in slice 4.2.
  const { data: released, error: cycleError } = await supabase
    .from("content_cycles")
    .update({ status: "in_review" })
    .eq("id", cycle.id)
    .eq("status", "drafting")
    .select("id")
    .maybeSingle();
  if (cycleError) return { ok: false, error: cycleError.message };
  if (!released) {
    return { ok: false, error: "This month is already released." };
  }

  await sendReleaseEmail(cycle);

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { releasedItemCount: (promoted ?? []).length } };
}

/** Which cycle email a log line is about. */
type CycleEmailKind = "release" | "re-release";

/**
 * What both cycle emails need from outside the cycle row: the recipient, the
 * bare month name, and the deadline label. Null — with the reason logged —
 * when there is nobody to send to or nothing honest to say about the
 * deadline. A DB error throws; the callers' best-effort wrapper catches it.
 */
async function loadCycleEmailContext(
  cycle: ContentCycleRecord,
  kind: CycleEmailKind
): Promise<{
  to: string;
  recipientName: string;
  monthName: string;
  deadlineLabel: string;
} | null> {
  const supabase = getSupabaseServiceClient();

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("name, email")
    .eq("id", cycle.client_id)
    .maybeSingle();
  if (clientError) throw new Error(clientError.message);

  const client = clientRow as { name: string; email: string | null } | null;
  if (!client?.email) {
    // Email is nullable on `clients` (migration 004 — a client can be on
    // file with only a phone). Nothing to send to, and nothing broken.
    console.error(
      `[content] ${kind} email skipped for cycle ${cycle.id}: client has no email on file`
    );
    return null;
  }

  // Non-null by the time either sender runs: both gates refuse a cycle with
  // no deadline. Guarded anyway rather than asserted, because the senders are
  // best-effort and a wrong date in a client's inbox is worse than no email.
  if (!cycle.revision_deadline) {
    console.error(
      `[content] ${kind} email skipped for cycle ${cycle.id}: no revision deadline`
    );
    return null;
  }

  return {
    to: client.email,
    recipientName: client.name,
    monthName: monthNameForMonthKey(cycle.month.slice(0, 7)),
    deadlineLabel: weekdayDateLabelForDateKey(
      dateKeyInTimezone(new Date(cycle.revision_deadline))
    ),
  };
}

/**
 * The one Resend call both cycle emails make. Resend is constructed inline
 * with the same `from` fallback as every other send site in the codebase.
 * There is no shared wrapper anywhere, and introducing one here — mid-feature
 * — would be a refactor smuggled into a feature phase; this helper is scoped
 * to the two senders in this file.
 */
async function sendCycleEmail(input: {
  resendKey: string;
  kind: CycleEmailKind;
  cycle: ContentCycleRecord;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resend = new Resend(input.resendKey);
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ||
    "Digital Bloom Socials <onboarding@resend.dev>";

  const { error: sendError } = await resend.emails.send({
    from: fromAddress,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  if (sendError) {
    console.error(
      `[content] ${input.kind} email failed for cycle ${input.cycle.id}:`,
      sendError.message
    );
  }
}

/**
 * Tell the client their month is ready (spec §5.1, copy deck Screen 8).
 *
 * BEST-EFFORT, and never throws. The cycle is already released by the time
 * this runs; a Resend outage, a client with no email on file, or a missing API
 * key must not report the release as failed or roll it back. This is the same
 * contract the payment-confirmation send uses
 * (`app/owner/invoices/_actions.ts`, "Confirmation email is best-effort"),
 * down to the console.error-and-continue on failure.
 */
async function sendReleaseEmail(cycle: ContentCycleRecord): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  try {
    const context = await loadCycleEmailContext(cycle, "release");
    if (!context) return;

    // The count the client will actually face, not the number of rows this
    // release promoted. On a release after an unrelease-and-add those differ:
    // one row was promoted, but the queue still holds everything the client
    // had not got to, and "Kelsey has 1 post ready for your review" would be
    // wrong in front of eleven others.
    const supabase = getSupabaseServiceClient();
    const { data: awaiting, error: awaitingError } = await supabase
      .from("content_items")
      .select("id")
      .eq("cycle_id", cycle.id)
      .eq("status", "in_review");
    if (awaitingError) throw new Error(awaitingError.message);

    await sendCycleEmail({
      resendKey,
      kind: "release",
      cycle,
      to: context.to,
      subject: buildContentReleaseEmailSubject(context.monthName),
      html: buildContentReleaseEmailHtml({
        recipientName: context.recipientName,
        monthName: context.monthName,
        postCount: (awaiting ?? []).length,
        deadlineLabel: context.deadlineLabel,
        reviewUrl: `${resolveBaseUrl()}/client/review`,
      }),
    });
  } catch (err) {
    console.error(`[content] release email threw for cycle ${cycle.id}:`, err);
  }
}

/**
 * Tell the client their updated posts are back (spec §4.8, copy deck Screen
 * 10). Same best-effort contract as `sendReleaseEmail`.
 *
 * `updatedCount` is the number of posts THIS re-release sent back — the deck's
 * "Kelsey made the changes you asked for on 3 posts" — not everything awaiting
 * review, which may still include posts the client never reached.
 */
async function sendRereleaseEmail(
  cycle: ContentCycleRecord,
  updatedCount: number
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  try {
    const context = await loadCycleEmailContext(cycle, "re-release");
    if (!context) return;

    await sendCycleEmail({
      resendKey,
      kind: "re-release",
      cycle,
      to: context.to,
      subject: buildContentRereleaseEmailSubject(
        context.monthName,
        updatedCount
      ),
      html: buildContentRereleaseEmailHtml({
        recipientName: context.recipientName,
        monthName: context.monthName,
        updatedCount,
        deadlineLabel: context.deadlineLabel,
        reviewUrl: `${resolveBaseUrl()}/client/review`,
      }),
    });
  } catch (err) {
    console.error(
      `[content] re-release email threw for cycle ${cycle.id}:`,
      err
    );
  }
}

/**
 * Take a released month back out of the client's hands (spec §4.4, step 1).
 *
 * ONLY THE CYCLE ROW IS TOUCHED. Item statuses are left alone on purpose:
 * they ARE the client's progress, and the queue is resumable precisely because
 * progress lives in per-item status rather than in a separate table. Flipping
 * items back to 'draft' here would erase an approval the client already gave
 * and then silently re-ask for it on re-release.
 *
 * The deadline is likewise untouched. It is a stored timestamp, not a
 * countdown from release (spec §4.3), so an unrelease does not extend it and a
 * re-release does not restart it.
 */
export async function unreleaseContentCycleAction(
  cycleId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };
  const { cycle } = cycleCheck;

  if (cycle.status === "locked") {
    return {
      ok: false,
      error: "This month is locked. Reviews are closed for it.",
    };
  }
  if (cycle.status !== "in_review") {
    return { ok: false, error: "This month has not been released." };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .update({ status: "drafting" })
    .eq("id", cycle.id)
    .eq("status", "in_review")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "This month has not been released." };

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

/**
 * Kelsey's Lock now (spec §4.6): close a released month before its deadline,
 * for when a client has said they are finished.
 *
 * THE SAME UNIT OF WORK AS THE DEADLINE SWEEP — `lockCycle`, with
 * `locked_by = 'owner'` and the moment she confirmed as the instant. So the
 * posts the client never got to flip to approved with `approved_by = 'auto'`
 * here too (approved 2026-09-04): the client did not approve them, leaving
 * them at 'in_review' inside a locked month would strand them permanently,
 * and the client's Screen 6 banner already tells the two closes apart by
 * `locked_by`. Changes still with her stay with her; she can accept or deny
 * them after the lock, she just cannot re-release.
 *
 * IRREVERSIBLE. There is no unlock in the spec and none here; the board's
 * confirm dialog says so before the press. Guarded on 'in_review' twice —
 * once on the row this action read, once inside the conditional UPDATE — so
 * a press that lands after the sweep, or after an unrelease, matches no row
 * and is reported rather than re-applied.
 *
 * No email. The spec sends none on a lock, and the release email already
 * carries the auto-approve sentence.
 */
export async function lockContentCycleAction(
  cycleId: string
): Promise<ActionResult<{ autoApprovedCount: number }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };
  const { cycle } = cycleCheck;

  if (cycle.status === "locked") {
    return { ok: false, error: "This month is already locked." };
  }
  if (cycle.status !== "in_review") {
    return { ok: false, error: "This month has not been released." };
  }

  let result;
  try {
    result = await lockCycle(getSupabaseServiceClient(), {
      cycle,
      lockedAt: new Date().toISOString(),
      lockedBy: "owner",
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not lock this month",
    };
  }
  if (result.outcome === "raced") {
    return {
      ok: false,
      error:
        "This month is no longer open for review — refresh to see where it stands.",
    };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { autoApprovedCount: result.autoApproved } };
}

/** Owner-facing. The gate's idle state and the lost-race case say the same thing. */
const NOTHING_TO_SEND_BACK = "There are no accepted requests to send back.";

/**
 * Send accepted revisions back to the client for another look (spec §4.8).
 *
 * A SEPARATE ACTION FROM RELEASE, by decision (Step 1 audit, approved
 * 2026-08-31). Release is the visibility switch and is guarded on 'drafting';
 * this runs on a month that is ALREADY 'in_review' and never writes
 * `content_cycles` at all. The cycle stays released throughout — the client's
 * queue, their approvals, their locked posts, and the deadline are all
 * untouched; only the posts coming back change state. Unrelease is for adding
 * a forgotten post (§4.4) and plays no part here.
 *
 * WHAT IT WRITES, and nothing else: each promoted post flips
 * 'changes_requested' -> 'in_review' with `current_round` set to the accepted
 * round's number + 1. That advance is what makes round 2 reachable from the
 * client's submit action, what the queue's "Round 2" chip reads, and what
 * Screen 5's Updated state keys on. Denied posts stay where they are (deny is
 * final), approved posts stay approved, drafts stay draft.
 *
 * ALL OR NOTHING, per the batch gate in `evaluateRereleaseGate`, re-run here
 * after the press — the page's button state is a hint. One conditional UPDATE
 * per distinct round number (posts in one month can sit on different rounds
 * after a partial denial and a second re-release), each matched on
 * `status = 'changes_requested'`, so a concurrent press finds nothing left to
 * promote and is reported as such WITHOUT sending a second email. There is no
 * transaction: a crash mid-loop leaves some posts promoted, and the next
 * press promotes the rest — the gate still sees them as addressed.
 *
 * The email is best-effort and last, like release's.
 */
export async function rereleaseContentCycleAction(
  cycleId: string
): Promise<ActionResult<{ updatedCount: number }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const cycleCheck = await loadCycle(cycleId);
  if (!cycleCheck.ok) return { ok: false, error: cycleCheck.error };
  const { cycle } = cycleCheck;

  if (cycle.status === "locked") {
    return {
      ok: false,
      error: "This month is locked. Reviews are closed for it.",
    };
  }
  if (cycle.status !== "in_review") {
    return { ok: false, error: "This month has not been released." };
  }

  let gate;
  try {
    gate = await evaluateRereleaseGate(cycle);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Could not check whether this month is ready to re-release",
    };
  }
  if (!gate.ok) return { ok: false, error: gate.reason ?? NOTHING_TO_SEND_BACK };

  const supabase = getSupabaseServiceClient();

  const idsByRound = new Map<number, string[]>();
  for (const promotion of gate.promotions) {
    const ids = idsByRound.get(promotion.roundNumber) ?? [];
    ids.push(promotion.itemId);
    idsByRound.set(promotion.roundNumber, ids);
  }

  let updatedCount = 0;
  for (const [roundNumber, ids] of idsByRound) {
    const { data: promoted, error: promoteError } = await supabase
      .from("content_items")
      .update({ status: "in_review", current_round: roundNumber + 1 })
      .in("id", ids)
      .eq("cycle_id", cycle.id)
      .eq("status", "changes_requested")
      .select("id");
    if (promoteError) return { ok: false, error: promoteError.message };
    updatedCount += (promoted ?? []).length;
  }

  if (updatedCount === 0) {
    // A concurrent press promoted everything between the gate and the write.
    return { ok: false, error: NOTHING_TO_SEND_BACK };
  }

  await sendRereleaseEmail(cycle, updatedCount);

  revalidatePath(CONTENT_PATH);
  return { ok: true, data: { updatedCount } };
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
      // Written on every transition, not only on failure: migration 016's
      // `content_assets_error_reason_check` requires a reason to belong to a
      // 'failed' row and nothing else, so a move to 'ready' has to clear it in
      // the same statement.
      error_reason:
        status.status === "failed" ? describeStreamError(status) : null,
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

export type { AssetPreview };

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

  const previews = await buildAssetPreviews(
    (data ?? []) as ContentAssetRecord[]
  );
  return { ok: true, data: previews };
}

// ---------------------------------------------------------------------------
// Playback — mint a fresh player URL for one ready video
// ---------------------------------------------------------------------------

/**
 * Mint a signed player URL for a single asset, at the moment Kelsey presses
 * play.
 *
 * `fetchContentAssetPreviewsAction` already returns an `iframeUrl` with every
 * ready video, so this exists for exactly one reason: TOKEN LIFETIME. Those
 * URLs are signed when the panel opens and die an hour later, and a panel left
 * open across a long build session would otherwise expand a tile into a player
 * whose token expired forty minutes ago — a dead frame with no error, because
 * a cross-origin iframe cannot tell us it failed.
 *
 * Minting here instead means the token is always seconds old when playback
 * starts, and a 6-15 second clip finishes an hour inside its own validity. The
 * expiry problem is moved from "the URL might be stale when used" to "the URL
 * is minted at use", which removes it rather than mitigating it.
 *
 * Owner-guarded only. Spec §3.5a's ownership check is Pattern B — fetch the
 * row, compare `client_id`, then mint — and it applies to the CLIENT review
 * surface in Phase 4, where the caller could be any client. Here the caller is
 * already proven to be the single owner, for whom every content item is in
 * scope by definition; there is no second party to distinguish. The row is
 * still fetched and checked for being a ready Stream video, because handing
 * `createPlaybackUrls` a storage key or an unencoded video mints a token for
 * something that cannot play.
 */
export async function createContentAssetPlaybackAction(
  assetId: string
): Promise<ActionResult<{ iframeUrl: string; expiresAt: number }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!assetId) return { ok: false, error: "Missing asset id" };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const asset = data as ContentAssetRecord | null;
  if (!asset) return { ok: false, error: "Asset not found" };
  if (asset.provider !== "stream") {
    return { ok: false, error: "That asset is not a video" };
  }
  if (asset.status !== "ready") {
    return {
      ok: false,
      error:
        asset.status === "failed"
          ? (asset.error_reason ?? "That video failed to encode.")
          : "That video is still processing.",
    };
  }

  try {
    const { iframeUrl, expiresAt } = createPlaybackUrls(asset.external_id);
    return { ok: true, data: { iframeUrl, expiresAt } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start playback",
    };
  }
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

  // The app-layer half of migration 017's SET NULL decision: deleting an
  // asset that a staged replacement points at would null the replacement's
  // marker, turning a discoverable staged row into one nothing lists — its
  // video still billing Stream storage with no surface left to remove it
  // from. Refused here; the replacement is removable on its own, first.
  const { data: stagedRows, error: stagedErr } = await supabase
    .from("content_assets")
    .select("id")
    .eq("replaces_asset_id", assetId)
    .limit(1);
  if (stagedErr) return { ok: false, error: stagedErr.message };
  if ((stagedRows ?? []).length > 0) {
    return {
      ok: false,
      error:
        "This video has a replacement in progress. Remove the replacement first.",
    };
  }

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

// ---------------------------------------------------------------------------
// Revision requests — read what a client asked for (Phase 5, slice 5.3)
// ---------------------------------------------------------------------------

/**
 * The latest submitted change request on one item, display-ready, or null
 * when nothing has been submitted.
 *
 * READ-ONLY BY DESIGN, and deliberately the only revision surface this phase
 * gives Kelsey: spec 4.7 says seeing a request does not obligate her to act,
 * and accept/deny/replace belong to Phase 6. The panel calls this on open —
 * the `fetchContentAssetPreviewsAction` arrangement — rather than the data
 * riding in on the page payload, so the request shown is live at open time
 * instead of as stale as the board's last navigation. Arrival NOTICE is the
 * rollup poll's job (it already counts `changes_requested`); this is the
 * detail read behind it.
 */
export async function fetchRevisionRequestAction(
  itemId: string
): Promise<ActionResult<RevisionRequestView | null>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!itemId) return { ok: false, error: "Missing item id" };

  try {
    return { ok: true, data: await fetchLatestRevisionRequest(itemId) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not load the request",
    };
  }
}

// ---------------------------------------------------------------------------
// Replacement upload — the accept path's new version (Phase 6, slice 6.1)
//
// A replacement is the Phase 2 video mint with one structural difference: the
// row is born STAGED — same position as the video it supersedes, replaced_at
// set at birth, replaces_asset_id pointing at its target (migration 017).
//
// The two invariants that force that shape:
//   - the row is written at mint, before a byte moves, so Postgres records
//     every Stream UID this app ever creates (the Phase 2 leak rule);
//   - the partial unique index allows one LIVE row per position, and the
//     replacement targets the position its predecessor still holds.
// Born-superseded satisfies both, and gets client invisibility free: every
// live-asset read already filters `replaced_at is null`, so the client never
// sees a half-arrived candidate while the month sits in review.
//
// The upload itself, the finalize call, and the status poll are all the
// existing Phase 2 machinery — a staged row is an ordinary content_assets row
// to every one of them. The swap that makes it live is slice 6.2's commit,
// not this mint.
// ---------------------------------------------------------------------------

export interface CreateReplacementVideoUploadInput {
  /** The LIVE video this new version will supersede on accept. */
  targetAssetId: string;
  /** Exact byte length — tus fixes Upload-Length at creation. */
  sizeBytes: number;
}

export async function createReplacementVideoUploadAction(
  input: CreateReplacementVideoUploadInput
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

  const supabase = getSupabaseServiceClient();

  const { data: targetData, error: targetErr } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", input.targetAssetId)
    .maybeSingle();
  if (targetErr) return { ok: false, error: targetErr.message };
  const target = targetData as ContentAssetRecord | null;
  if (!target) return { ok: false, error: "Asset not found" };
  if (target.provider !== "stream" || target.kind !== "video") {
    return { ok: false, error: "Only videos can be replaced" };
  }
  if (target.replaced_at !== null) {
    return { ok: false, error: "That video has already been replaced" };
  }

  // A replacement exists to ACCEPT a request, so one must be open. Without
  // this the staging machinery becomes a general swap-any-video path, which
  // is not a thing this feature offers — outside a revision, Kelsey removes
  // and re-adds.
  const { data: roundData, error: roundErr } = await supabase
    .from("revision_rounds")
    .select("id, status")
    .eq("content_item_id", target.content_item_id)
    .not("submitted_at", "is", null)
    .order("round_number", { ascending: false })
    .limit(1);
  if (roundErr) return { ok: false, error: roundErr.message };
  const round = ((roundData ?? []) as Array<{ id: string; status: string }>)[0];
  if (!round || round.status !== "open") {
    return {
      ok: false,
      error: "There is no open change request on this post",
    };
  }

  // One staged replacement per target. App-layer only — the partial index
  // cannot see staged rows — so a double-press race can slip a second one
  // through; that is benign (both stay listed and removable in the panel,
  // and the commit activates exactly the one it is given), but the ordinary
  // path should not mint a second video for one target.
  const { data: existingStaged, error: stagedErr } = await supabase
    .from("content_assets")
    .select("id")
    .eq("replaces_asset_id", target.id)
    .limit(1);
  if (stagedErr) return { ok: false, error: stagedErr.message };
  if ((existingStaged ?? []).length > 0) {
    return {
      ok: false,
      error:
        "A replacement for this video already exists. Remove it first to start over.",
    };
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

  const { data, error } = await supabase
    .from("content_assets")
    .insert({
      content_item_id: target.content_item_id,
      // The target's own slot: staged rows are outside the partial index (a
      // non-null replaced_at exempts them), so sharing the position is legal
      // now and becomes THE position when the accept swap activates the row.
      position: target.position,
      kind: "video",
      provider: "stream",
      external_id: upload.uid,
      status: "processing",
      bytes: sizeBytes,
      // Born staged. Cleared together by the accept commit, never separately
      // (the content_assets_staged_not_live_check constraint).
      replaced_at: new Date().toISOString(),
      replaces_asset_id: target.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    // Same one-place-only cleanup as the ordinary mint: nothing has been
    // uploaded, no row records the UID, so taking the video out now removes
    // the only case where a minted UID goes unrecorded.
    try {
      await deleteVideo(upload.uid);
    } catch (cleanupErr) {
      console.error(
        "stream replacement mint cleanup failed; video left pending",
        upload.uid,
        cleanupErr
      );
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
// Accept — the commit that resolves a request (Phase 6, slice 6.2)
//
// THE ORDERING IS THE DESIGN. Four steps, and the first one is the Stream
// delete — the inversion of the house DB-row-first contract, deliberately
// (Step 1 review, approved 2026-08-31):
//
//   1. delete the superseded video from Cloudflare   — abort on failure
//   2. stamp the old row (replaced_at = now)         — it becomes history
//   3. activate the staged row (clear replaced_at
//      and replaces_asset_id in one UPDATE)          — it becomes live
//   4. resolve the round (status = 'addressed',
//      resolved_at, resolution_note)                 — the commit bit
//
// Why delete FIRST: the alternative — swap first, delete best-effort after —
// makes a failed Stream delete a dismissible error over an orphan that bills
// storage minutes forever with nothing left to retry it. Delete-first makes
// the orphan STRUCTURALLY impossible: a failure aborts the whole accept with
// nothing changed, the error lands in Kelsey's panel, and the retry is the
// same button. It is never swallowed and never best-effort.
//
// The steps run without a transaction (the house has none), so every one is
// conditional and a retry from any crash point completes:
//
//   after 1 — old row live, video gone: the client could briefly meet a dead
//             player on a locked post; retry heals (an already-deleted video
//             counts as success, see deleteStreamVideos).
//   after 2 — no live asset at the position: invisible to the client queue's
//             slide list, and the re-release gate refuses the item ("post has
//             no media") until the retry completes. Step 2's update is
//             guarded on `replaced_at is null`, so the replay no-ops it.
//   after 3 — swap done, round still open: the panel still shows the request;
//             re-accepting detects the already-activated row and skips to 4.
//   after 4 — done; a replay returns ok from the early addressed check.
//
// The partial unique index is the swap's own guard: step 3's activation
// re-checks (content_item_id, position) uniqueness at write time, so it
// physically cannot land before step 2's stamp.
//
// Accepting is legal WITHOUT a replacement: a caption or schedule request
// needs no new asset — Kelsey edits the item through the ordinary form and
// the accept just resolves the round. `content_items` is untouched either
// way; the item stays 'changes_requested' until re-release (Step 5) returns
// it to the client.
// ---------------------------------------------------------------------------

/** Mirrors the client form's per-note ceiling; a note is one note. */
const MAX_RESOLUTION_NOTE_CHARS = 2000;

export interface AcceptRevisionInput {
  roundId: string;
  /** The staged replacement to swap in; null = accept with no new version. */
  stagedAssetId: string | null;
  /** Optional note to the client — Screen 5's "A note from Kelsey". */
  note: string;
}

export async function acceptRevisionAction(
  input: AcceptRevisionInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.roundId) return { ok: false, error: "Missing round id" };
  const note = (input.note ?? "").trim();
  if (note.length > MAX_RESOLUTION_NOTE_CHARS) {
    return { ok: false, error: "The note is too long" };
  }

  const supabase = getSupabaseServiceClient();

  const { data: roundData, error: roundErr } = await supabase
    .from("revision_rounds")
    .select("*")
    .eq("id", input.roundId)
    .maybeSingle();
  if (roundErr) return { ok: false, error: roundErr.message };
  const round = roundData as RevisionRoundRecord | null;
  if (!round || !round.submitted_at) {
    return { ok: false, error: "Request not found" };
  }
  if (round.status === "addressed") {
    // A replay of a completed accept — the double-press, the retry after a
    // crash past step 4. The work is done; say so.
    revalidatePath(CONTENT_PATH);
    return { ok: true };
  }
  if (round.status === "denied") {
    return { ok: false, error: "This request was already denied" };
  }

  // --- Steps 1–3: the swap, when a replacement is in play -------------------

  if (input.stagedAssetId) {
    const { data: stagedData, error: stagedErr } = await supabase
      .from("content_assets")
      .select("*")
      .eq("id", input.stagedAssetId)
      .maybeSingle();
    if (stagedErr) return { ok: false, error: stagedErr.message };
    const staged = stagedData as ContentAssetRecord | null;
    if (!staged || staged.content_item_id !== round.content_item_id) {
      return { ok: false, error: "Replacement not found" };
    }

    if (staged.replaces_asset_id !== null) {
      // Still staged: the full swap.
      if (staged.status !== "ready") {
        return {
          ok: false,
          error:
            staged.status === "failed"
              ? "The new version failed to encode — remove it and upload another."
              : "The new version is still processing.",
        };
      }

      // The FK guarantees the target row exists while the marker is set.
      const { data: targetData, error: targetErr } = await supabase
        .from("content_assets")
        .select("*")
        .eq("id", staged.replaces_asset_id)
        .maybeSingle();
      if (targetErr) return { ok: false, error: targetErr.message };
      const target = targetData as ContentAssetRecord | null;
      if (!target) return { ok: false, error: "The current video is missing" };

      // Step 1 — the superseded video leaves Cloudflare first. Run even when
      // the target row is already stamped (a crash-after-2 replay): an
      // already-deleted video answers 404, which deleteStreamVideos counts
      // as success. A real failure aborts here with nothing written.
      if (target.provider === "stream") {
        const sweep = await deleteStreamVideos([target.external_id]);
        if (!sweep.ok) return { ok: false, error: sweep.error };
      }

      // Step 2 — stamp the old row. Guarded, so a replay matches nothing.
      const { error: stampErr } = await supabase
        .from("content_assets")
        .update({ replaced_at: new Date().toISOString() })
        .eq("id", target.id)
        .is("replaced_at", null);
      if (stampErr) return { ok: false, error: stampErr.message };

      // Step 3 — activate the staged row. Both columns clear in ONE update
      // (the staged-not-live constraint requires it), and the partial unique
      // index re-checks the position here — this cannot land before step 2.
      const { error: activateErr } = await supabase
        .from("content_assets")
        .update({ replaced_at: null, replaces_asset_id: null })
        .eq("id", staged.id)
        .not("replaces_asset_id", "is", null);
      if (activateErr) {
        if (activateErr.code === PG_UNIQUE_VIOLATION) {
          // The double-staged race: another replacement already took the
          // slot live. This one stays staged, listed, and removable.
          return {
            ok: false,
            error:
              "Another version already took this slot. Remove this replacement.",
          };
        }
        return { ok: false, error: activateErr.message };
      }
    } else {
      // No marker: either the crash-after-3 replay (our activation landed,
      // the resolve did not) or a live asset id — both mean no swap is
      // needed, and resolving is the correct remaining work. A stamped
      // history row is neither.
      if (staged.replaced_at !== null) {
        return { ok: false, error: "That replacement is no longer current" };
      }
    }
  }

  // --- Step 4: resolve the round --------------------------------------------

  // Note and status land in one statement — migration 017's scope constraint
  // ties resolution_note to a resolved round, so they cannot be split.
  const { data: resolved, error: resolveErr } = await supabase
    .from("revision_rounds")
    .update({
      status: "addressed",
      resolved_at: new Date().toISOString(),
      resolution_note: note.length > 0 ? note : null,
    })
    .eq("id", round.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (resolveErr) return { ok: false, error: resolveErr.message };
  if (!resolved) {
    // Matched nothing: a concurrent accept (or deny) got there first. Read
    // which, and report honestly rather than guessing.
    const { data: current, error: reReadErr } = await supabase
      .from("revision_rounds")
      .select("status")
      .eq("id", round.id)
      .maybeSingle();
    if (reReadErr) return { ok: false, error: reReadErr.message };
    const status = (current as Pick<RevisionRoundRecord, "status"> | null)
      ?.status;
    if (status === "addressed") {
      revalidatePath(CONTENT_PATH);
      return { ok: true };
    }
    return { ok: false, error: "This request was already denied" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deny — the refusal (Phase 6, slice 6.3)
//
// One conditional write. Deny touches NOTHING but the round: no asset moves,
// and `content_items` is deliberately untouched — the item stays
// 'changes_requested', and the client's "Kept as planned" state derives from
// the latest submitted round being 'denied' (Step 1 review, approved
// 2026-08-31; the Phase 7 hand-off note in the build plan's Known issues is
// the other half of that decision).
//
// The reason is REQUIRED — spec §4.7, and the deck marks the client-facing
// label ("A note from Kelsey") required, not optional. Migration 017's
// `revision_rounds_denied_reason_check` makes the requirement structural;
// the validation here exists to say it in words before Postgres says it in
// error codes.
//
// Deny is FINAL. There is no un-deny and no reopen — the client's declined
// state says "staying as planned" and offers Messages, not a retry.
//
// NO EMAIL IS SENT, by decision (feature doc decisions log, 2026-08-31): the
// client discovers the deny on the post; the re-release email covers mixed
// cycles, and Kelsey messages directly for a full denial.
// ---------------------------------------------------------------------------

export interface DenyRevisionInput {
  roundId: string;
  /** Required. The client sees this verbatim as "A note from Kelsey". */
  reason: string;
}

export async function denyRevisionAction(
  input: DenyRevisionInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.roundId) return { ok: false, error: "Missing round id" };
  const reason = (input.reason ?? "").trim();
  if (reason.length === 0) {
    return { ok: false, error: "A deny needs a written reason — the client sees it." };
  }
  if (reason.length > MAX_RESOLUTION_NOTE_CHARS) {
    return { ok: false, error: "The note is too long" };
  }

  const supabase = getSupabaseServiceClient();

  const { data: roundData, error: roundErr } = await supabase
    .from("revision_rounds")
    .select("*")
    .eq("id", input.roundId)
    .maybeSingle();
  if (roundErr) return { ok: false, error: roundErr.message };
  const round = roundData as RevisionRoundRecord | null;
  if (!round || !round.submitted_at) {
    return { ok: false, error: "Request not found" };
  }
  if (round.status === "denied") {
    // A replay — the double-press, the retry after a timeout. Done is done.
    revalidatePath(CONTENT_PATH);
    return { ok: true };
  }
  if (round.status === "addressed") {
    return { ok: false, error: "This request was already accepted" };
  }

  // A staged replacement contradicts a deny: "keeping it as planned" while a
  // new version sits uploaded is one decision too many for one button. The
  // UI gates this too; here it is enforced against the data.
  const { data: stagedRows, error: stagedErr } = await supabase
    .from("content_assets")
    .select("id")
    .eq("content_item_id", round.content_item_id)
    .not("replaces_asset_id", "is", null)
    .limit(1);
  if (stagedErr) return { ok: false, error: stagedErr.message };
  if ((stagedRows ?? []).length > 0) {
    return {
      ok: false,
      error:
        "A new version is uploaded for this post. Remove it first — a denied request keeps the current video.",
    };
  }

  // Reason and status land in one statement — 017's constraints demand both
  // directions (denied requires a note; a note requires a resolution).
  const { data: denied, error: denyErr } = await supabase
    .from("revision_rounds")
    .update({
      status: "denied",
      resolved_at: new Date().toISOString(),
      resolution_note: reason,
    })
    .eq("id", round.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (denyErr) return { ok: false, error: denyErr.message };
  if (!denied) {
    // Lost a race. Read what won and report it honestly.
    const { data: current, error: reReadErr } = await supabase
      .from("revision_rounds")
      .select("status")
      .eq("id", round.id)
      .maybeSingle();
    if (reReadErr) return { ok: false, error: reReadErr.message };
    const status = (current as Pick<RevisionRoundRecord, "status"> | null)
      ?.status;
    if (status === "denied") {
      revalidatePath(CONTENT_PATH);
      return { ok: true };
    }
    return { ok: false, error: "This request was already accepted" };
  }

  revalidatePath(CONTENT_PATH);
  return { ok: true };
}

/**
 * The replacement panel's read: the item's replaceable videos and any staged
 * rows. Fetched on panel open and after every mutation, the
 * `fetchContentAssetPreviewsAction` arrangement.
 */
export async function fetchReplacementStateAction(
  itemId: string
): Promise<ActionResult<ReplacementState>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!itemId) return { ok: false, error: "Missing item id" };

  try {
    return { ok: true, data: await fetchReplacementState(itemId) };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not load the replacement",
    };
  }
}

/**
 * Mint the side-by-side pair (spec §4.7: "she can play the current and new
 * versions side by side before committing").
 *
 * Both URLs are minted in one action at press time — one round trip, both
 * tokens seconds old — and both with `autoplay: false`: the two players mount
 * in the same commit, and two clips autostarting together is two audio
 * tracks at once. Each waits at its poster for its own press.
 *
 * Owner-guarded only, like every mint on this surface: the caller is the
 * single owner, for whom every asset is in scope by definition.
 */
export async function createReplacementCompareAction(
  stagedAssetId: string
): Promise<ActionResult<{ currentIframeUrl: string; newIframeUrl: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!stagedAssetId) return { ok: false, error: "Missing asset id" };

  const supabase = getSupabaseServiceClient();
  const { data: stagedData, error: stagedErr } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", stagedAssetId)
    .maybeSingle();
  if (stagedErr) return { ok: false, error: stagedErr.message };
  const staged = stagedData as ContentAssetRecord | null;
  if (!staged || staged.replaces_asset_id === null) {
    return { ok: false, error: "Replacement not found" };
  }
  if (staged.status !== "ready") {
    return {
      ok: false,
      error:
        staged.status === "failed"
          ? (staged.error_reason ?? "That video failed to encode.")
          : "The new version is still processing.",
    };
  }

  const { data: targetData, error: targetErr } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", staged.replaces_asset_id)
    .maybeSingle();
  if (targetErr) return { ok: false, error: targetErr.message };
  const current = targetData as ContentAssetRecord | null;
  if (!current || current.status !== "ready") {
    return { ok: false, error: "The current video can't be played right now" };
  }

  try {
    return {
      ok: true,
      data: {
        currentIframeUrl: createPlaybackUrls(current.external_id, {
          autoplay: false,
        }).iframeUrl,
        newIframeUrl: createPlaybackUrls(staged.external_id, {
          autoplay: false,
        }).iframeUrl,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start playback",
    };
  }
}
