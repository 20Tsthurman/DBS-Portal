import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTENT_AUTO_ACTOR,
  type ContentCycleLockedBy,
  type ContentCycleRecord,
} from "@/lib/supabase";

/**
 * SERVER ONLY. Closing a month to the client — the one unit of work behind
 * both the deadline sweep (spec §4.3, §5.7; this file's `runDeadlineSweep`)
 * and Kelsey's Lock now (§4.6; `lockContentCycleAction`). One function, two
 * callers, so a month cannot be closed two slightly different ways.
 *
 * WHAT A LOCK WRITES, and nothing else:
 *
 *   content_items   status 'in_review' -> 'approved', approved_by = 'auto',
 *                   approved_at = the lock instant. These are the posts the
 *                   client never acted on — the spec's "untouched" (§4.3).
 *   content_cycles  status 'in_review' -> 'locked', with locked_at and
 *                   locked_by stamped in the same UPDATE (migration 018 makes
 *                   the pair structural).
 *
 * WHAT IT LEAVES ALONE (settled 2026-09-02, Step 1 review):
 *
 *   'changes_requested', in all three round states. Denied is RESOLVED: the
 *   client's "Kept as planned" derives from the item's latest submitted round
 *   being 'denied', and a flip here would render "Approved automatically"
 *   over a decision Kelsey already communicated. Open and addressed are WITH
 *   KELSEY: the client acted, the deck's auto copy ("this post hadn't been
 *   reviewed") would be false, and she can still accept or deny after the
 *   lock — neither action checks cycle status. 'draft' is invisible to the
 *   client and stays draft (a known issue records that release refuses a
 *   locked cycle, so such a draft is stranded). 'approved' and 'published'
 *   are already where they end up.
 *
 * ORDER: items first, then the cycle — release's ordering, for release's
 * reason. There is no transaction (supabase-js), so a crash between the two
 * leaves approved items in a still-open cycle, which the next run completes
 * because the cycle still matches. The reverse order would leave a locked
 * cycle holding 'in_review' posts that no future run selects and no client
 * can act on.
 *
 * IDEMPOTENT BY CONSTRUCTION: every write is conditioned on the status just
 * read, so a second run over the same cycle matches nothing and reports it
 * as raced. Mid-edit is safe by column disjointness — item edits write
 * caption, date and platform; accept and deny write rounds and assets; this
 * writes item status and cycle status only. A client approval in the same
 * instant is itself conditioned on `status = 'in_review'`, so whichever side
 * lands first wins cleanly and the other matches no row. Re-release is the
 * only other writer of item status; its gate requires a future deadline and
 * the sweep requires a past one.
 *
 * THE LOCK INSTANT is the caller's. The sweep passes the cycle's
 * `revision_deadline` — not the run time, which lands one to three hours
 * later and would date every "Reviews ended" string to the wrong day. Lock
 * now passes the moment Kelsey confirmed.
 *
 * The Supabase client is a parameter rather than a module import so the
 * test can stand in a recording fake and pin the write conditions above, the
 * way `lib/stream.test.ts` pins the mint options — those conditions are the
 * idempotency contract, and a dropped `.eq("status", ...)` would not fail
 * the typecheck.
 */

export interface LockCycleInput {
  /** The cycle as the caller read it. Only `id` is written against. */
  cycle: Pick<ContentCycleRecord, "id">;
  /** ISO instant to stamp on the cycle and on every auto-approved post. */
  lockedAt: string;
  lockedBy: ContentCycleLockedBy;
  /**
   * Sweep only. Adds `revision_deadline <= this` to the cycle write, so a
   * deadline that Kelsey extended or cleared between the sweep's read and its
   * write leaves the cycle open. The posts flipped in the first write stay
   * approved either way — that window is one second wide at 2am — and the
   * cycle is reported as raced. Lock now passes nothing here: Kelsey is
   * closing the month on purpose, deadline or no deadline.
   */
  deadlineAtOrBefore?: string;
}

export interface LockCycleResult {
  /** 'raced' = the cycle write matched no row; someone else moved it first. */
  outcome: "locked" | "raced";
  /** Posts this call flipped to approved, whatever the cycle outcome. */
  autoApproved: number;
}

export async function lockCycle(
  supabase: SupabaseClient,
  input: LockCycleInput
): Promise<LockCycleResult> {
  const { cycle, lockedAt, lockedBy, deadlineAtOrBefore } = input;

  const { data: flipped, error: itemError } = await supabase
    .from("content_items")
    .update({
      status: "approved",
      approved_at: lockedAt,
      approved_by: CONTENT_AUTO_ACTOR,
    })
    .eq("cycle_id", cycle.id)
    .eq("status", "in_review")
    .select("id");
  if (itemError) {
    throw new Error(`Failed to auto-approve posts: ${itemError.message}`);
  }
  const autoApproved = (flipped ?? []).length;

  let cycleQuery = supabase
    .from("content_cycles")
    .update({ status: "locked", locked_at: lockedAt, locked_by: lockedBy })
    .eq("id", cycle.id)
    .eq("status", "in_review");
  if (deadlineAtOrBefore !== undefined) {
    cycleQuery = cycleQuery.lte("revision_deadline", deadlineAtOrBefore);
  }
  const { data: locked, error: cycleError } = await cycleQuery
    .select("id")
    .maybeSingle();
  if (cycleError) {
    throw new Error(`Failed to lock cycle: ${cycleError.message}`);
  }

  return { outcome: locked ? "locked" : "raced", autoApproved };
}

/** The cron route's JSON body. Every field is a count; nothing is a list. */
export interface DeadlineSweepSummary {
  /** Cycles the read found past their deadline and still in review. */
  cyclesDue: number;
  cyclesLocked: number;
  /** Posts flipped to approved across every cycle, raced ones included. */
  itemsAutoApproved: number;
  /** Cycle writes that matched no row — moved by someone else mid-sweep. */
  raced: number;
  /** Cycles whose lock threw. Logged; the sweep goes on to the next one. */
  errors: number;
}

/**
 * The daily sweep (spec §3.9). Cycles at 'in_review' whose deadline is set
 * and already past get locked, each independently — one cycle's failure is
 * logged and counted, never a reason to leave the others open a day longer.
 *
 * `revision_deadline` is a timestamptz compared against a UTC instant, so
 * the run hour decides how soon after a Central-time deadline the lock lands
 * (vercel.json: one to three hours), never whether the comparison is right.
 * The explicit `IS NOT NULL` is redundant with `<=` and kept on purpose: it
 * is the documented predicate, and a released cycle whose deadline was
 * cleared is meant to fall out here (known issue; Lock now closes it).
 *
 * `now` is a parameter for the test. Production passes nothing.
 */
export async function runDeadlineSweep(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<DeadlineSweepSummary> {
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("status", "in_review")
    .not("revision_deadline", "is", null)
    .lte("revision_deadline", nowIso);
  if (error) {
    throw new Error(`Failed to fetch cycles past deadline: ${error.message}`);
  }
  const due = (data ?? []) as ContentCycleRecord[];

  const summary: DeadlineSweepSummary = {
    cyclesDue: due.length,
    cyclesLocked: 0,
    itemsAutoApproved: 0,
    raced: 0,
    errors: 0,
  };

  for (const cycle of due) {
    // The predicate above guarantees this; the narrowing is for the
    // compiler. A row that reaches here without a deadline means the read
    // and the row disagree, which is worth a log line, not a lock.
    const lockedAt = cycle.revision_deadline;
    if (!lockedAt) {
      summary.errors += 1;
      console.error("[content-deadlines] due cycle has no deadline", cycle.id);
      continue;
    }
    try {
      const result = await lockCycle(supabase, {
        cycle,
        lockedAt,
        lockedBy: CONTENT_AUTO_ACTOR,
        deadlineAtOrBefore: nowIso,
      });
      summary.itemsAutoApproved += result.autoApproved;
      if (result.outcome === "locked") {
        summary.cyclesLocked += 1;
      } else {
        summary.raced += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error("[content-deadlines] lock failed", cycle.id, err);
    }
  }

  return summary;
}
