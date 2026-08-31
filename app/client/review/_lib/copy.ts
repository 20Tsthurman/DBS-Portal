import { DEADLINE_AUTO_APPROVE_SENTENCE } from "@/lib/contentEmails";

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
