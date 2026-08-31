import { getSupabaseServiceClient } from "@/lib/supabase";

/**
 * SERVER ONLY. Where a client stands in a released month (spec 4.5).
 *
 * INFORMATIONAL, AND ONLY THAT. Spec 4.5 is explicit: the rollup "tells her
 * whether to reach out or whether a client has likely finished, but she is not
 * required to act on it." Nothing keys off these numbers - no lock, no
 * reminder, no nudge. Kelsey cannot reliably tell "finished" from "paused
 * partway" by watching them (4.6), which is exactly why the deadline sweep,
 * not this panel, is what closes a month.
 *
 * One function, two callers - the server page for the first paint and the
 * guarded API route for the poll - so the counts cannot be computed two
 * slightly different ways and flicker between them every thirty seconds. Same
 * arrangement `assetPreviews` uses for the same reason.
 */

export interface CycleRollup {
  /** Client approved it, or it has since been published. */
  approved: number;
  /** Client sent notes back. Spec 4.5 calls this "revised". */
  revised: number;
  /** Released to them, not yet acted on. Spec 4.5 calls this "untouched". */
  untouched: number;
  /** approved + revised + untouched. Excludes drafts. */
  total: number;
}

export const EMPTY_ROLLUP: CycleRollup = {
  approved: 0,
  revised: 0,
  untouched: 0,
  total: 0,
};

/**
 * Tally one cycle's items by status.
 *
 * 'draft' is excluded from every bucket INCLUDING the total, because a draft
 * is a post the client cannot see. Counting it as "untouched" would report a
 * client as behind on work that was never sent to them - the same filter the
 * client queue applies, for the same reason.
 *
 * One query and an in-memory tally rather than four counting queries: a month
 * is ~20 rows, and four round trips on a 30-second poll is three more than
 * this needs.
 */
export async function fetchCycleRollup(cycleId: string): Promise<CycleRollup> {
  if (!cycleId) return EMPTY_ROLLUP;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_items")
    .select("status")
    .eq("cycle_id", cycleId)
    .neq("status", "draft");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ status: string }>;
  const rollup = { ...EMPTY_ROLLUP, total: rows.length };

  for (const row of rows) {
    if (row.status === "approved" || row.status === "published") {
      rollup.approved += 1;
    } else if (row.status === "changes_requested") {
      rollup.revised += 1;
    } else {
      // 'in_review' - and anything a later phase adds falls here rather than
      // vanishing from a total that is meant to add up on screen.
      rollup.untouched += 1;
    }
  }

  return rollup;
}
