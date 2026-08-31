import { DEADLINE_AUTO_APPROVE_SENTENCE } from "@/lib/contentEmails";
import type { RevisionCategory } from "@/lib/supabase";

/**
 * Every client-facing string on the review queue, in one module.
 *
 * `docs/DBS_Content_Approval_Copy_Deck.md` IS THE SOURCE OF TRUTH. Nothing
 * here may be reworded, shortened, or "improved" at build time — the deck was
 * produced by a design pass against a stated constraint (spec §5: some clients
 * are older and less technically confident) and the wording is the deliverable,
 * not a placeholder.
 *
 * Strings live here rather than inline in JSX so the deck can be diffed
 * against one file. Screen and row are named on every export.
 *
 * Singular and plural are separate deck rows, not a runtime `s` — "1 posts are
 * ready" is the kind of thing that reads as broken software to exactly the
 * audience this surface was designed for.
 */

// --- Navigation --------------------------------------------------------------

/** Deck, "Navigation": sidebar item and top bar title. */
export const NAV_LABEL = "Review & Approve";

// --- Screen 1: the queue -----------------------------------------------------

/** Screen 1, "Page title". `monthName` is bare — "October", not "October 2026". */
export function queueTitle(monthName: string): string {
  return `Your ${monthName} content`;
}

/** Screen 1, "Instruction". */
export const QUEUE_INSTRUCTION =
  "Go through each post and approve it, or ask for changes.";

/** Screen 1, "Deadline card, line 1". Label is "Friday, September 25". */
export function deadlineHeadline(deadlineLabel: string): string {
  return `Review by ${deadlineLabel}`;
}

/**
 * Screen 1, "Deadline card, line 2" — whose deck note reads "Same sentence
 * reused verbatim in the release email". Imported rather than retyped so the
 * two cannot drift.
 */
export const DEADLINE_EXPLAINER = DEADLINE_AUTO_APPROVE_SENTENCE;

/** Screen 1, "Count — fresh" / "Count — fresh, one post". */
export function countFresh(total: number): string {
  return total === 1
    ? "1 post is ready for your review."
    : `${total} posts are ready for your review.`;
}

/** Screen 1, "Count — partway" / "Count — partway, one left". */
export function countRemaining(remaining: number): string {
  return remaining === 1
    ? "1 post still needs your review."
    : `${remaining} posts still need your review.`;
}

/** Screen 1, "Count — all handled". */
export const COUNT_ALL_HANDLED = "Nothing needs you right now.";

/** Screen 1, the right-aligned meta beside the count. */
export function reviewedMeta(reviewed: number, total: number): string {
  return `${reviewed} of ${total} reviewed`;
}

/** Screen 1, "All-handled banner title". */
export const ALL_HANDLED_TITLE = "That's everything for now";

/**
 * Screen 1, "All-handled banner body". Four deck rows: changes-requested and
 * all-approved, each with a one-post form.
 *
 * The changes-requested variant wins whenever ANY post has changes sent — the
 * deck's note says "Only when at least one post has changes sent", and the
 * all-approved wording ("Your October content is set") would be wrong while
 * Kelsey still owes them work.
 */
export function allHandledBody(input: {
  total: number;
  hasChangesRequested: boolean;
  monthName: string;
}): string {
  if (input.hasChangesRequested) {
    return input.total === 1
      ? "You've reviewed your post. Kelsey is working on the changes you asked for — you'll get an email when the update is ready to look at."
      : `You've reviewed all ${input.total} posts. Kelsey is working on the changes you asked for — you'll get an email when the updates are ready to look at.`;
  }
  return input.total === 1
    ? `You approved your post. Your ${input.monthName} content is set — Kelsey will take it from here.`
    : `You approved all ${input.total} posts. Your ${input.monthName} content is set — Kelsey will take it from here.`;
}

/** Screen 1, "Table headers (desktop)". */
export const TABLE_HEADERS = {
  post: "Post",
  scheduled: "Scheduled",
  platform: "Platform",
  status: "Status",
} as const;

/** Screen 1, "Row action — needs review" / "Row action — otherwise". */
export const ROW_ACTION_REVIEW = "Review";
export const ROW_ACTION_VIEW = "View";

// --- Screen 2: a single post -------------------------------------------------

/** Screen 2, "Back link". Also the second action on the approved state. */
export const BACK_LINK = "All posts";

/** Screen 2, "Position". */
export function positionLabel(position: number, total: number): string {
  return `Post ${position} of ${total}`;
}

/**
 * Screen 2, "Scheduled line". `dateLabel` is "Saturday, October 10";
 * `platform` is "Instagram Reel".
 */
export function scheduledLine(dateLabel: string, platform: string): string {
  return `Scheduled for ${dateLabel} · ${platform}`;
}

/** Screen 2, "Caption label". */
export const CAPTION_LABEL = "Caption";

/** Screen 2, primary and secondary actions. */
export const ACTION_APPROVE = "Approve";
export const ACTION_REQUEST_CHANGES = "Request changes";

/** Screen 2, "Carousel counter" — "2 of 5". */
export function carouselCounter(position: number, total: number): string {
  return `${position} of ${total}`;
}

// --- Approve confirmation (the light dialog) ---------------------------------

export const APPROVE_DIALOG_TITLE = "Approve this post?";

/** `goesOutLabel` is "Saturday, October 10" — weekday and date, no year. */
export function approveDialogBody(goesOutLabel: string): string {
  return `It goes out ${goesOutLabel}. Once you approve, changes can't be requested on this post.`;
}

export const APPROVE_DIALOG_CANCEL = "Not yet";
export const APPROVE_DIALOG_CONFIRM = "Approve post";

// --- Screen 3: request changes -----------------------------------------------

/** Screen 3, "Panel title". Same words as the Screen 2 button, own export so
 * each deck row stays individually traceable. */
export const REQUEST_CHANGES_TITLE = "Request changes";

/**
 * Screen 3, "Context line" — "Saturday, Oct 10 · Instagram Reel". The date is
 * the deck's short form (see `shortWeekdayDateLabelForDateKey`), not Screen 2's
 * long one.
 */
export function requestChangesContext(
  dateLabel: string,
  platform: string
): string {
  return `${dateLabel} · ${platform}`;
}

/** Screen 3, "Helper". */
export const REQUEST_CHANGES_HELPER =
  "Pick what you'd like changed, then tell Kelsey what you have in mind.";

/**
 * Screen 3, the eight category rows. `label` and `hint` are the deck's
 * "Label — hint" pairs split at the em dash; `prompt` is the deck's
 * per-category question, shown once the category is selected.
 *
 * Declared as a Record over `RevisionCategory` so adding a ninth category to
 * the enum fails the typecheck here rather than silently rendering a row with
 * no copy.
 */
export const CATEGORY_COPY: Record<
  RevisionCategory,
  { label: string; hint: string; prompt: string }
> = {
  clips: {
    label: "Clips",
    hint: "The video footage",
    prompt: "What should change about the clips?",
  },
  caption: {
    label: "Caption",
    hint: "The written text below the post",
    prompt: "What should change about the caption?",
  },
  music: {
    label: "Music",
    hint: "The song or sound",
    prompt: "What should change about the music?",
  },
  pacing: {
    label: "Pacing",
    hint: "How fast or slow it moves",
    prompt: "What should change about the pacing?",
  },
  text_overlay: {
    label: "Text overlay",
    hint: "The words shown on screen",
    prompt: "What should change about the on-screen text?",
  },
  cover: {
    label: "Cover",
    hint: "The image people see first",
    prompt: "What should change about the cover?",
  },
  schedule: {
    label: "Schedule",
    hint: "The date it goes out",
    prompt: "When should this go out instead?",
  },
  other: {
    label: "Other",
    hint: "Anything else",
    prompt: "What else would you like changed?",
  },
};

/** The deck's row order for Screen 3 — also the order of the fixed enum. */
export const CATEGORY_ORDER: RevisionCategory[] = [
  "clips",
  "caption",
  "music",
  "pacing",
  "text_overlay",
  "cover",
  "schedule",
  "other",
];

/** Screen 3, "Field placeholder" — shared by every category comment field. */
export const CATEGORY_FIELD_PLACEHOLDER = "Tell Kelsey what you'd like instead.";

/** Screen 3, "Moments — heading". Video posts only. */
export const MOMENTS_HEADING = "Notes on moments";

/** Screen 3, "Moments — helper". */
export const MOMENTS_HELPER =
  "Optional. Pause the video where you want to point, then add your note.";

/** Screen 3, "Moments — add button". `timecode` is live — "0:12". */
export function momentsAddLabel(timecode: string): string {
  return `Add a note at ${timecode}`;
}

/**
 * Screen 3, "Moments — no timecode yet" (deck row added 2026-08-31): helper
 * text rendered IN PLACE OF the add button until the video has a position.
 * Never render a disabled "Add a note at 0:00".
 */
export const MOMENTS_NO_TIMECODE =
  "Play the video, then pause where you want to point.";

/** Screen 3, "Moments — placeholder". */
export const MOMENTS_PLACEHOLDER = "What about this moment?";

/** Screen 3, "Footer helper (round 1)". */
export const FOOTER_HELPER_ROUND_1 =
  "One round of changes is included with your month.";

/** Screen 3, "Send button". Also Screen 4's confirm label. */
export const SEND_BUTTON = "Send to Kelsey";

/** Screen 3, "Disabled-send helper". Shown only while nothing is selected. */
export const DISABLED_SEND_HELPER =
  "Pick at least one thing above to get started.";

// --- Screen 4: send confirmation (round 1) -----------------------------------

export const SEND_DIALOG_TITLE = "Send to Kelsey?";

/** Screen 4, "Body, line 1". */
export const SEND_DIALOG_LINE_1 =
  "Kelsey will get these notes and start on the changes.";

/**
 * Screen 4, "Body, line 2" — split because the deck emphasizes exactly
 * "Once you send, nothing more can be added to this post" and no more.
 */
export const SEND_DIALOG_FINALITY = {
  emphasized: "Once you send, nothing more can be added to this post",
  rest: " — so take a moment to make sure it covers everything.",
} as const;

/** Screen 4, "Body, line 3" — the round-1 framing. */
export const SEND_DIALOG_LINE_3 =
  "This is part of your included round of changes.";

export const SEND_DIALOG_CANCEL = "Go back";
// The confirm label is SEND_BUTTON — the deck uses "Send to Kelsey" for both.

/**
 * Screen 4, the moments summary chip — "2 notes on moments", singular row
 * added 2026-08-31. Category chips are the bare `CATEGORY_COPY` labels; this
 * is the only chip that carries a count.
 */
export function momentsChip(count: number): string {
  return count === 1 ? "1 note on moments" : `${count} notes on moments`;
}

// --- Screen 5: after the client acts -----------------------------------------

export const APPROVED_TITLE = "Approved";

/**
 * Screen 5, "Approved — body".
 *
 * Two date shapes on purpose, both straight from the deck: the approval is
 * dated with its weekday ("Saturday, September 19") because it is a receipt of
 * something the client did, and the send date is bare ("October 10") because
 * it is a plan, not an appointment.
 */
export function approvedBody(
  approvedLabel: string,
  goesOutLabel: string
): string {
  return `You approved this post on ${approvedLabel}. Kelsey will take it from here — it goes out ${goesOutLabel}.`;
}

/** Screen 5, "Approved — actions" is "Next post · All posts". */
export const ACTION_NEXT_POST = "Next post";

/** Screen 5, "With Kelsey — title". */
export const WITH_KELSEY_TITLE = "Your notes are with Kelsey";

/**
 * Screen 5, "With Kelsey — body". `sentLabel` is "Saturday, September 19" —
 * the same weekday shape the approved receipt uses, for the same reason: it
 * dates something the client did. No message link here — the escape hatch
 * lives on the cycle-level working state only (Screen 6, spec §5.6).
 */
export function withKelseyBody(sentLabel: string): string {
  return `Sent ${sentLabel}. Kelsey is on it — the updated post will show up here, and you'll get an email when it's ready.`;
}

/** Screen 5, "Sent-notes heading" — above the readback of what they sent. */
export const SENT_NOTES_HEADING = "What you asked for";

// --- Screen 6: cycle states ---------------------------------------------------

/** Screen 6, "Working — title". */
export const WORKING_TITLE = "Kelsey is making your changes";

/**
 * Screen 6, "Working — body", with the one-post variant added 2026-08-31.
 * `changedCount` counts the posts with changes sent, not the whole month.
 */
export function workingBody(changedCount: number): string {
  return changedCount === 1
    ? "You asked for changes on 1 post. She's on it — you'll get an email when the updated post is ready to review. You can still open any post to read it."
    : `You asked for changes on ${changedCount} posts. She's on it — you'll get an email when the updated posts are ready to review. You can still open any post to read it.`;
}

/**
 * Screen 6, "Working — footer" — THE escape hatch, split at the link the way
 * `MEDIA_ERROR` is. It appears here and nowhere else: repeated on locked
 * posts it becomes a feedback side-channel that defeats the per-item lock
 * (spec §5.6).
 */
export const WORKING_FOOTER = {
  beforeLink: "Forgot something? ",
  linkText: "Send Kelsey a message",
} as const;

// --- Status pills ------------------------------------------------------------

export const PILL_NEEDS_REVIEW = "Needs your review";
export const PILL_WITH_KELSEY = "With Kelsey";
export const PILL_APPROVED = "Approved";

/** "Round 2" — the forest chip, shown from round 2 on. */
export function roundChip(round: number): string {
  return `Round ${round}`;
}

// --- Screen 7: no active cycle -----------------------------------------------

/** Screen 7, "Nothing yet — title" / "Nothing yet — body". */
export const NOTHING_YET_TITLE = "Nothing to review yet";
export const NOTHING_YET_BODY =
  "When Kelsey has your month of posts ready, it will land here — and you'll get an email letting you know. There's nothing you need to do right now.";

/** Screen 7, "Between months — title". */
export function betweenMonthsTitle(monthName: string): string {
  return `${monthName} is all set`;
}

/** Screen 7, "Between months — body". */
export function betweenMonthsBody(
  monthName: string,
  nextMonthName: string
): string {
  return `Your ${monthName} posts are approved and with Kelsey. When ${nextMonthName} is ready to review, it will show up here — and you'll get an email.`;
}

/** Screen 7, "Recap card" — three lines: eyebrow, month, meta. */
export const RECAP_EYEBROW = "Last month";

/**
 * Recap meta. `closedLabel` is "September 25" — no weekday, no year.
 *
 * A null label drops the whole "Reviews closed ..." clause rather than
 * printing it with a gap where the date goes. Only reachable if a cycle was
 * locked without a deadline, which the release gate makes very unlikely — but
 * "Reviews closed" trailing into nothing reads as broken software.
 */
export function recapMeta(
  postCount: number,
  closedLabel: string | null
): string {
  const posts = postCount === 1 ? "1 post" : `${postCount} posts`;
  return closedLabel === null
    ? posts
    : `${posts} · Reviews closed ${closedLabel}`;
}

// --- Errors ------------------------------------------------------------------

/** Errors, "Approve failed". */
export const APPROVE_FAILED =
  "That didn't go through. Give it another try in a moment — nothing was approved.";

/**
 * Errors, "Send failed" (deck row added 2026-08-31). One message for every
 * send failure, same reasoning as APPROVE_FAILED — and its "nothing was sent"
 * promise is kept by the write sequence: a partial write is invisible
 * everywhere until the final commit step lands (see `submitChangeRequestAction`).
 */
export const SEND_FAILED =
  "That didn't go through. Give it another try in a moment — nothing was sent to Kelsey.";

/**
 * Errors, "Video won't play" and "Photo won't load", split at the link.
 *
 * Assembled, each reads:
 *   "This video isn't loading right now. Refresh the page to try again, or
 *    send Kelsey a message if it keeps happening."
 *
 * The pieces exist because "send Kelsey a message" is a link to Messages —
 * the same treatment Screen 5 gives it in the declined and auto-approved
 * states. Splitting a sentence is the cost of a link inside it; the sentence
 * itself is unchanged from the deck.
 */
export const MEDIA_ERROR = {
  videoLead: "This video isn't loading right now.",
  photoLead: "This photo isn't loading right now.",
  beforeLink: "Refresh the page to try again, or ",
  linkText: "send Kelsey a message",
  afterLink: " if it keeps happening.",
} as const;
