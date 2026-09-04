import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentCycleRecord,
  type ContentItemRecord,
  type RevisionNoteRecord,
  type RevisionRoundRecord,
} from "@/lib/supabase";
import {
  computeRoundCharge,
  isRoundPriced,
  type RoundBilling,
} from "@/lib/revisionBilling";

/**
 * The client's own reads for /client/review.
 *
 * OWNERSHIP IS PATTERN A THROUGHOUT — `client_id` is baked into every query
 * rather than checked after the fact (the shape of `fetchMyInvoiceById`,
 * `app/client/invoices/_lib/queries.ts`). Nothing here can return a row
 * belonging to someone else, and a wrong id returns `null` identically to a
 * missing one so nothing leaks "exists, but not yours".
 *
 * This is the only enforcement there is: the project has no RLS policies and
 * no browser-side Supabase client, so authorization lives in these functions.
 *
 * `content_items.client_id` is denormalized alongside `cycle_id` (migration
 * 015) precisely so that ownership stays a single-table filter here instead of
 * a join back through `content_cycles`.
 */

/** An item plus its live assets, ordered by `position`. */
export interface ReviewItem extends ContentItemRecord {
  assets: ContentAssetRecord[];
}

/**
 * Items the client is not allowed to see yet.
 *
 * 'draft' is the un-released state. Release promotes 'draft' -> 'in_review',
 * so filtering it out here is what keeps a post Kelsey adds to an
 * already-released month invisible until she releases again.
 */
const CLIENT_HIDDEN_ITEM_STATUS = "draft";

/**
 * Which cycles the client can open: THE VISIBILITY SWITCH, in one place.
 *
 *   'in_review'  — out for review; the queue with its actions.
 *   'locked'     — closed, and shown READ-ONLY (Screen 6's Deadline or
 *                  Closed-early banner over the same list) for as long as its
 *                  content month is the current Central month or later. Once
 *                  that month is over it drops out here and the queue page
 *                  falls through to Screen 7's recap card instead (decided
 *                  2026-09-04). Reviews close September 25, the list stays
 *                  up through October with its auto-approved rows, and on
 *                  November 1 the client sees "October is all set" until
 *                  November is released.
 *   'drafting'   — never: Kelsey still building, or a month she unreleased.
 *
 * PostgREST filter syntax, for `.or()`. `currentMonthKey` is "YYYY-MM" in
 * PORTAL_TIMEZONE and `content_cycles.month` is always the first of the
 * month, so `>= YYYY-MM-01` is exactly "this month or later".
 */
function visibleCycleFilter(currentMonthKey: string): string {
  return `status.eq.in_review,and(status.eq.locked,month.gte.${currentMonthKey}-01)`;
}

/**
 * The one cycle the queue shows, or null.
 *
 * `visibleCycleFilter` is the switch: out for review, or locked and still
 * this month. Ordered newest-first and capped at one: the schema allows a
 * client to have several months released at once, and the queue is a
 * single-month surface, so the most recent month wins rather than the page
 * rendering an ambiguous merge — a November in review outranks a locked
 * October, which is what a client expects to land on.
 */
export async function fetchMyActiveCycle(
  clientId: string,
  currentMonthKey: string
): Promise<ContentCycleRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("client_id", clientId)
    .or(visibleCycleFilter(currentMonthKey))
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ContentCycleRecord[];
  return rows[0] ?? null;
}

/**
 * The most recently closed month, for the between-cycles recap card
 * (spec §5.9, copy deck Screen 7).
 *
 * 'locked' is written by the deadline sweep and by Kelsey's Lock now (both
 * Phase 7, through `lockCycle`). The card's "Reviews closed" date is the
 * row's `locked_at`, not its deadline — the two differ on a manual lock.
 *
 * Not month-bounded, unlike `fetchMyActiveCycle`: the recap points at the
 * last finished month however long ago it closed, and the queue page only
 * asks for it once the visibility switch has returned nothing.
 */
export async function fetchMyLastClosedCycle(
  clientId: string
): Promise<ContentCycleRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "locked")
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ContentCycleRecord[];
  return rows[0] ?? null;
}

/**
 * Every post in one of the client's cycles that they are allowed to see,
 * chronological, each with its live assets attached.
 *
 * Chronological because the queue mirrors the month: the client works forward
 * through the dates their posts go out. There is no "unreviewed first" sort —
 * a queue that reorders itself under someone as they work is disorienting, and
 * per-item status already marks what is left.
 */
export async function fetchMyReviewItems(
  clientId: string,
  cycleId: string
): Promise<ReviewItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("client_id", clientId)
    .eq("cycle_id", cycleId)
    .neq("status", CLIENT_HIDDEN_ITEM_STATUS)
    .order("scheduled_for", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ContentItemRecord[];
  if (rows.length === 0) return [];

  const assetsByItem = await fetchLiveAssetsByItem(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...row,
    assets: assetsByItem.get(row.id) ?? [],
  }));
}

/**
 * The cycle one of the client's items belongs to, but ONLY when that cycle is
 * one the queue would show them (`visibleCycleFilter`: out for review, or
 * locked and still this month). Null otherwise.
 *
 * Two gates, and both matter. `client_id` on the item read is ownership; the
 * cycle status is release state. A client owns their `drafting` items too, so
 * ownership alone would let a bookmarked URL open a post from a month Kelsey
 * is still building or has unreleased. The same month bound as the queue,
 * so a bookmarked post from a locked month that has already dropped to the
 * recap card 404s rather than opening a page the list no longer leads to.
 *
 * Null is returned identically for every failure — no such item, someone
 * else's item, an unreleased cycle — so a caller can only ever answer "not
 * found" and nothing leaks the difference.
 */
export async function fetchMyReviewableCycleForItem(
  clientId: string,
  itemId: string,
  currentMonthKey: string
): Promise<ContentCycleRecord | null> {
  if (!itemId) return null;
  const supabase = getSupabaseServiceClient();

  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("cycle_id")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  const item = itemData as { cycle_id: string } | null;
  if (!item) return null;

  const { data: cycleData, error: cycleError } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("id", item.cycle_id)
    .eq("client_id", clientId)
    .or(visibleCycleFilter(currentMonthKey))
    .maybeSingle();
  if (cycleError) throw new Error(cycleError.message);
  return (cycleData as ContentCycleRecord | null) ?? null;
}

/**
 * How many posts were in a closed month — the recap card's count.
 *
 * Counts what the client could see, not every row, so a draft Kelsey left
 * behind in a locked month is not reported back to them as a post.
 */
export async function countMyCycleItems(
  clientId: string,
  cycleId: string
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("cycle_id", cycleId)
    .neq("status", CLIENT_HIDDEN_ITEM_STATUS);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** A submitted round with its notes — the sent-notes readback (Screen 5). */
export interface SubmittedRound {
  round: RevisionRoundRecord;
  notes: RevisionNoteRecord[];
}

/**
 * The item's most recent SUBMITTED round, with every note in it. Null when
 * nothing has been submitted (including when the item is not this client's —
 * same silent null as every other read here).
 *
 * TWO STANDING RULES live on this function because every later reader of
 * rounds and notes — the Phase 6 accept/deny surface included — inherits
 * them:
 *
 *   1. ROUNDS ARE READ WITH `submitted_at IS NOT NULL`, ALWAYS. The submit
 *      write runs without a transaction (see `submitChangeRequestAction`),
 *      and a failed attempt can leave behind a round row — possibly with
 *      notes — whose `submitted_at` is still null. That debris is reused and
 *      replaced by the retry; it is NEVER data, and a read that forgets this
 *      filter will render a half-written round as if the client sent it.
 *
 *   2. NEVER GROUP RAW NOTES BY CATEGORY — PARTITION ON `timestamp_seconds`
 *      FIRST. A "note on a moment" carries the constant category 'other'
 *      (the schema requires a category and no listed one is honest for a
 *      timestamped note — decided 2026-08-31); `timestamp_seconds IS NOT
 *      NULL` is the discriminator. Group first, and a moment note shows up
 *      as a phantom "Other" the client never selected.
 *
 * Ordered newest round first so re-releases keep working: from Phase 6 on an
 * item can hold several submitted rounds, and this surface always shows the
 * latest. Notes come back in created_at order as a stable base; display
 * ordering (deck order for categories, chronological for moments) is the
 * renderer's job, because a single batch insert stamps every note with the
 * same created_at.
 */
export async function fetchMySubmittedRound(
  clientId: string,
  itemId: string
): Promise<SubmittedRound | null> {
  const supabase = getSupabaseServiceClient();

  // Ownership first — rounds carry no client_id, so the item read is the gate.
  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("id")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!itemData) return null;

  const { data: roundData, error: roundError } = await supabase
    .from("revision_rounds")
    .select("*")
    .eq("content_item_id", itemId)
    .not("submitted_at", "is", null)
    .order("round_number", { ascending: false })
    .limit(1);
  if (roundError) throw new Error(roundError.message);
  const round = ((roundData ?? []) as RevisionRoundRecord[])[0];
  if (!round) return null;

  const { data: notesData, error: notesError } = await supabase
    .from("revision_notes")
    .select("*")
    .eq("round_id", round.id)
    .order("created_at", { ascending: true });
  if (notesError) throw new Error(notesError.message);

  return { round, notes: (notesData ?? []) as RevisionNoteRecord[] };
}

/**
 * Which of these items have a DENIED latest round — the set behind every
 * "Kept as planned" derivation (queue pill, banner selection, the counting
 * rule of 2026-08-31: a denied request counts as neither changes-in-flight
 * nor approved).
 *
 * Deny writes nothing to `content_items` (migration 017's design), so this
 * read is the only way the client surface can know. STANDING RULE 1 applies:
 * rounds are read with `submitted_at IS NOT NULL`, always — an unsubmitted
 * row is debris, never data. The LATEST submitted round per item decides:
 * an item whose round 1 was addressed and whose round 2 is open is "with
 * Kelsey", not "kept as planned", whatever round 1 says.
 *
 * Like `fetchLiveAssetsByItem`, this is not ownership-checked on its own —
 * every caller has already constrained its item ids to one client.
 */
export async function fetchMyDeniedItemIds(
  itemIds: string[]
): Promise<Set<string>> {
  const denied = new Set<string>();
  if (itemIds.length === 0) return denied;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("revision_rounds")
    .select("content_item_id, round_number, status")
    .in("content_item_id", itemIds)
    .not("submitted_at", "is", null);
  if (error) throw new Error(error.message);

  const latest = new Map<string, { round: number; status: string }>();
  for (const raw of (data ?? []) as Array<
    Pick<RevisionRoundRecord, "content_item_id" | "round_number" | "status">
  >) {
    const current = latest.get(raw.content_item_id);
    if (!current || raw.round_number > current.round) {
      latest.set(raw.content_item_id, {
        round: raw.round_number,
        status: raw.status,
      });
    }
  }

  for (const [itemId, round] of latest) {
    if (round.status === "denied") denied.add(itemId);
  }
  return denied;
}

/**
 * The round numbers this cycle already carries a CHARGE for: every submitted
 * round in the cycle with `is_billable` set, reduced to its number. This is
 * the read behind the `per_round` "already covered" state (spec §6.2: "the
 * first billable submission of the round opens it, and later submissions in
 * the same round add nothing").
 *
 * Two callers ask the same question — the submit action at its commit ("is
 * round N open? then this post sends free") and the item page before the
 * dialog ("show the amount, or the covered copy?") — and they must answer it
 * identically, so it lives here once.
 *
 * PATTERN A: the items are constrained to this client AND this cycle before
 * any round is read, so a cycle id that is not theirs yields an empty set,
 * indistinguishable from a cycle with no charges. STANDING RULE 1:
 * `submitted_at IS NOT NULL`. A debris row can never carry a charge — the
 * commit writes the flag and the timestamp in one statement — but the read
 * says so anyway, because every read of rounds does.
 *
 * Round NUMBERS rather than rows, on purpose: nothing about the opener row
 * itself matters to either caller. In per_round the opener's own status is
 * irrelevant to whether later posts are covered; where its status IS weighed
 * — the fully-denied exemption — is the owner-side accrual read, over the
 * whole round group.
 */
export async function fetchMyBillableRoundNumbers(
  clientId: string,
  cycleId: string
): Promise<Set<number>> {
  const supabase = getSupabaseServiceClient();

  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("id")
    .eq("client_id", clientId)
    .eq("cycle_id", cycleId);
  if (itemError) throw new Error(itemError.message);
  const itemIds = ((itemData ?? []) as Array<{ id: string }>).map((r) => r.id);

  const opened = new Set<number>();
  if (itemIds.length === 0) return opened;

  const { data, error } = await supabase
    .from("revision_rounds")
    .select("round_number")
    .in("content_item_id", itemIds)
    .eq("is_billable", true)
    .not("submitted_at", "is", null);
  if (error) throw new Error(error.message);

  for (const raw of (data ?? []) as Array<
    Pick<RevisionRoundRecord, "round_number">
  >) {
    opened.add(raw.round_number);
  }
  return opened;
}

/** The cycle columns the charge decision reads. */
export type CycleBillingSettings = Pick<
  ContentCycleRecord,
  "included_rounds" | "extra_round_price" | "billing_mode"
>;

/**
 * What sending round `roundNumber` of this cycle would cost the client, from
 * the cycle row the caller has already read.
 *
 * ONE FUNCTION, TWO CALLERS, ON PURPOSE. The item page calls it to decide
 * which dialog to show (Screen 4, Screen 9, or the covered state) and the
 * submit action calls it at the commit to decide what to write. "The amount
 * shown must be the amount the commit writes" holds because they are the same
 * read: the same cycle columns, the same opener set through
 * `fetchMyBillableRoundNumbers`, the same `computeRoundCharge`. What the two
 * cannot share is the INSTANT — Kelsey can edit the cycle in between — and
 * that gap is closed by the consent the dialog carries (`_lib/consent.ts`),
 * not by this function.
 *
 * The opener read runs only when it can matter: per_round, and a round that
 * is priced at all. A round-1 page load should not pay for a query about
 * charges that cannot exist.
 *
 * `extra_round_price` is numeric and comes back from PostgREST as it comes;
 * coerced here, once, so the money function always sees a number.
 */
export async function resolveMyRoundBilling(
  clientId: string,
  cycleId: string,
  cycle: CycleBillingSettings,
  roundNumber: number
): Promise<RoundBilling> {
  const pricing = {
    roundNumber,
    includedRounds: cycle.included_rounds,
    extraRoundPrice:
      cycle.extra_round_price === null ? null : Number(cycle.extra_round_price),
  };
  let roundAlreadyOpenInCycle = false;
  if (cycle.billing_mode === "per_round" && isRoundPriced(pricing)) {
    const opened = await fetchMyBillableRoundNumbers(clientId, cycleId);
    roundAlreadyOpenInCycle = opened.has(roundNumber);
  }
  return computeRoundCharge({
    ...pricing,
    billingMode: cycle.billing_mode,
    roundAlreadyOpenInCycle,
  });
}

/**
 * Live assets for a set of items, keyed by item id, ordered by `position`.
 *
 * `replaced_at is null` matches the partial unique index that guarantees one
 * current asset per position; superseded rows are version history and never
 * render. Not exported and not ownership-checked on its own — every caller
 * above has already constrained its item ids to one client.
 */
async function fetchLiveAssetsByItem(
  itemIds: string[]
): Promise<Map<string, ContentAssetRecord[]>> {
  const out = new Map<string, ContentAssetRecord[]>();
  if (itemIds.length === 0) return out;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .in("content_item_id", itemIds)
    .is("replaced_at", null)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  for (const raw of (data ?? []) as ContentAssetRecord[]) {
    const list = out.get(raw.content_item_id);
    if (list) list.push(raw);
    else out.set(raw.content_item_id, [raw]);
  }
  return out;
}
