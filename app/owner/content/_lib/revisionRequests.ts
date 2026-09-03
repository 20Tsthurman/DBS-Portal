import {
  formatShortTimeInTimezone,
  weekdayDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import {
  getSupabaseServiceClient,
  type RevisionNoteRecord,
  type RevisionRoundRecord,
} from "@/lib/supabase";
import { REVISION_CATEGORY_LABELS, formatTimecode } from "./format";

/**
 * SERVER ONLY — reads with the service-role client. Kelsey's view of what a
 * client asked for on one item (spec §4.7: requests appear as they arrive;
 * seeing one does not obligate her to act, and Phase 6 owns accept/deny).
 *
 * Lives in `_lib/` on the `assetPreviews` precedent: the view types below
 * cross into the client component that renders them, which a `"use server"`
 * module cannot export.
 *
 * BOTH STANDING RULES FROM `app/client/review/_lib/queries.ts` APPLY HERE
 * and are applied here, once, so no renderer ever re-derives them:
 *
 *   1. Rounds are read with `submitted_at IS NOT NULL` — an unsubmitted row
 *      is debris from a failed client submit, never data.
 *   2. Notes are partitioned on `timestamp_seconds` BEFORE any grouping — a
 *      moment note's stored category is the constant 'other' and means
 *      nothing. The view model erases the trap entirely: a moment note comes
 *      out with a `timecode` and NO category label.
 */

/** One note, display-ready. Exactly one of the two labels is set. */
export interface RevisionRequestNoteView {
  id: string;
  /** Owner-voice category label ("Text overlay"); null on a moment note. */
  categoryLabel: string | null;
  /** "0:12" — the scrubber position; null on a category note. */
  timecode: string | null;
  body: string;
}

/** One submitted round, display-ready for the item panel. */
export interface RevisionRequestView {
  /** The round row itself — what Phase 6's accept and deny writes target. */
  roundId: string;
  roundNumber: number;
  /**
   * 'open' = awaiting Kelsey; 'addressed' = accepted; 'denied' = refused.
   * The replacement/accept controls render only while 'open'.
   */
  status: "open" | "addressed" | "denied";
  /**
   * Kelsey's own words on the resolution — the readback under the resolved
   * marker, so what she told the client stays visible to her. Null while
   * open, and on an accept she attached no note to.
   */
  resolutionNote: string | null;
  /** "Sunday, August 31 · 2:14pm" — when the client sent it, Central time. */
  sentLabel: string;
  /** Category notes in the form's fixed order, then moments chronologically. */
  notes: RevisionRequestNoteView[];
}

/** The fixed category order, mirrored from the client form (deck Screen 3). */
const CATEGORY_DISPLAY_ORDER = Object.keys(REVISION_CATEGORY_LABELS);

/**
 * The item's most recent submitted round as a display-ready view, or null
 * when nothing has been submitted. Owner-side: no client scoping — the
 * caller is behind `requireOwner`, and every item is Kelsey's by definition.
 *
 * Newest round first, like the client-side read: from Phase 6 on an item can
 * hold several submitted rounds and this panel shows the latest. (History
 * rendering, if ever wanted, is a Phase 6+ decision.)
 */
export async function fetchLatestRevisionRequest(
  itemId: string
): Promise<RevisionRequestView | null> {
  const supabase = getSupabaseServiceClient();

  const { data: roundData, error: roundError } = await supabase
    .from("revision_rounds")
    .select("*")
    .eq("content_item_id", itemId)
    .not("submitted_at", "is", null)
    .order("round_number", { ascending: false })
    .limit(1);
  if (roundError) throw new Error(roundError.message);
  const round = ((roundData ?? []) as RevisionRoundRecord[])[0];
  if (!round || !round.submitted_at) return null;

  const { data: notesData, error: notesError } = await supabase
    .from("revision_notes")
    .select("*")
    .eq("round_id", round.id)
    .order("created_at", { ascending: true });
  if (notesError) throw new Error(notesError.message);
  const notes = (notesData ?? []) as RevisionNoteRecord[];

  // Partition first (standing rule 2), then order each side deterministically
  // — a batch insert stamps every note with the same created_at, so the
  // stored order is not one.
  const categoryNotes = notes
    .filter((n) => n.timestamp_seconds === null)
    .sort(
      (a, b) =>
        CATEGORY_DISPLAY_ORDER.indexOf(a.category) -
        CATEGORY_DISPLAY_ORDER.indexOf(b.category)
    );
  const momentNotes = notes
    .filter((n) => n.timestamp_seconds !== null)
    .sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));

  const sentAt = new Date(round.submitted_at);
  const sentLabel = `${weekdayDateLabelForDateKey(
    dateKeyInTimezone(sentAt)
  )} · ${formatShortTimeInTimezone(sentAt)}`;

  return {
    roundId: round.id,
    roundNumber: round.round_number,
    status: round.status,
    resolutionNote: round.resolution_note,
    sentLabel,
    notes: [
      ...categoryNotes.map((n) => ({
        id: n.id,
        categoryLabel: REVISION_CATEGORY_LABELS[n.category],
        timecode: null,
        body: n.body,
      })),
      ...momentNotes.map((n) => ({
        id: n.id,
        categoryLabel: null,
        timecode: formatTimecode(n.timestamp_seconds ?? 0),
        body: n.body,
      })),
    ],
  };
}
