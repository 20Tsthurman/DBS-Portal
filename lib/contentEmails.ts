import { buildShell } from "@/lib/messageEmails";
import { escapeHtml } from "@/lib/escapeHtml";
import { firstNameOf } from "@/lib/invoiceEmails";

/**
 * The release notification (spec §5.1). Composed over `buildShell` the same
 * way `lib/invoiceEmails.ts` composes its three builders — same escaping
 * contract, same posture, no new shell.
 *
 * ESCAPING: `buildShell` escapes `headline`, `recipientName`, `portalUrl`,
 * `titleTag`, `buttonLabel` and `preheader` itself, but assigns
 * `bodyParagraph` RAW so callers can embed markup. Everything interpolated
 * into a body string below is therefore escaped here, exactly as the invoice
 * builders do it.
 *
 * Every string is from `docs/DBS_Content_Approval_Copy_Deck.md` — Screen 8
 * (release) and Screen 10 (re-release). Nothing here may be reworded at build
 * time.
 */

/**
 * Verbatim in two places by design: the release email's second body line and
 * the review queue's deadline card, line 2 (copy deck Screen 1, whose note
 * says "Same sentence reused verbatim in the release email").
 *
 * Exported so the queue imports this constant rather than retyping it — two
 * copies of one sentence drift the moment either is edited. This module has no
 * server-only imports, so a client component may import the constant safely.
 */
export const DEADLINE_AUTO_APPROVE_SENTENCE =
  "Anything you haven't reviewed by then is approved automatically, so your month stays on schedule.";

/**
 * Body line 2, shared BYTE-FOR-BYTE by the release email (Screen 8) and the
 * re-release email (Screen 10): "Reviews are open through <deadline>." plus
 * the auto-approve sentence. One function rather than two template strings,
 * so the deck's "verbatim" requirement holds by construction — the two emails
 * cannot drift from each other, and neither can drift from the queue's
 * deadline card, which renders the same exported constant.
 *
 * Rides in `extraBodyHtml` rather than being concatenated into line 1: the
 * shell wraps `bodyParagraph` in a single <p>, and two sentences of different
 * purpose in one paragraph is not what the deck draws. Margins match the
 * shell's own body paragraph so the two read as one column.
 */
function deadlineBodyLineHtml(deadlineLabel: string): string {
  return `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4B5C4E;font-family:'DM Sans',Arial,sans-serif;">Reviews are open through ${escapeHtml(
    deadlineLabel
  )}. ${escapeHtml(DEADLINE_AUTO_APPROVE_SENTENCE)}</p>`;
}

/** "1 post" / "12 posts". */
function postCountLabel(count: number): string {
  return `${count} ${count === 1 ? "post" : "posts"}`;
}

/** Copy deck Screen 8, Subject. `monthName` is bare — "October", not "October 2026". */
export function buildContentReleaseEmailSubject(monthName: string): string {
  return `Your ${monthName} posts are ready to review`;
}

export function buildContentReleaseEmailHtml(input: {
  recipientName: string;
  /** "October" — bare month name, per the deck's heading and subject. */
  monthName: string;
  /** Posts awaiting the client's review once this release lands. */
  postCount: number;
  /** "Friday, September 25" — weekday and date, no year. */
  deadlineLabel: string;
  /** `${resolveBaseUrl()}/client/review` — built by the caller. */
  reviewUrl: string;
}): string {
  const safeCount = escapeHtml(postCountLabel(input.postCount));

  // Two shapes, because "1 posts ... approve each one" is broken English and
  // this is the surface a client reads first. Deck rows: "Body, line 1" and
  // "Body, line 1, one post".
  const bodyLineOne =
    input.postCount === 1
      ? `Kelsey has ${safeCount} ready for your review — take a look when you have a minute, and approve it or ask for changes.`
      : `Kelsey has ${safeCount} ready for your review — take a look when you have a few minutes, and approve each one or ask for changes.`;

  return buildShell({
    titleTag: buildContentReleaseEmailSubject(input.monthName),
    // Raw, not pre-escaped: `buildShell` escapes `headline`, `titleTag`,
    // `preheader` and `buttonLabel` itself. Only `bodyParagraph` is assigned
    // raw, so only the body lines are escaped — line 1 above, line 2 inside
    // `deadlineBodyLineHtml`.
    headline: `Your ${input.monthName} content is ready`,
    preheader: `${postCountLabel(input.postCount)} · reviews open through ${input.deadlineLabel}`,
    bodyParagraph: bodyLineOne,
    extraBodyHtml: deadlineBodyLineHtml(input.deadlineLabel),
    portalUrl: input.reviewUrl,
    // The shell renders "Hi <recipientName>," — the deck's greeting is a first
    // name ("Hi Renee,"), so it is trimmed here rather than in the shell.
    recipientName: firstNameOf(input.recipientName),
    buttonLabel: "Review your posts",
  });
}

// ---------------------------------------------------------------------------
// Re-release — copy deck Screen 10 (added 2026-09-02, not on the canvas)
// ---------------------------------------------------------------------------

/** "1 updated post" / "3 updated posts" — Screen 10's preheader count. */
function updatedCountLabel(count: number): string {
  return `${count} updated ${count === 1 ? "post" : "posts"}`;
}

/** Copy deck Screen 10, "Subject" / "Subject, one post". */
export function buildContentRereleaseEmailSubject(
  monthName: string,
  updatedCount: number
): string {
  return updatedCount === 1
    ? `Your ${monthName} update is ready to review`
    : `Your ${monthName} updates are ready to review`;
}

/**
 * The re-release notification (spec §4.8): the posts whose requests Kelsey
 * accepted are back in the client's queue for another look.
 *
 * NO CHARGE LANGUAGE, on purpose. Before Phase 8's consent dialog exists a
 * round-2+ request carries no charge, so a sentence about one would be untrue
 * in front of the client — held with Screen 5's Updated small print. And no
 * denied-request line: by decision (2026-08-31) the client discovers a deny on
 * the post itself, and a month where every request was denied never
 * re-releases (the batch gate needs at least one accepted request).
 */
export function buildContentRereleaseEmailHtml(input: {
  recipientName: string;
  /** "October" — bare month name. */
  monthName: string;
  /** Posts sent back in THIS re-release — not everything awaiting review. */
  updatedCount: number;
  /** "Friday, September 25" — weekday and date, no year. */
  deadlineLabel: string;
  /** `${resolveBaseUrl()}/client/review` — built by the caller. */
  reviewUrl: string;
}): string {
  const safeCount = escapeHtml(String(input.updatedCount));

  // Deck rows "Body, line 1" and "Body, line 1, one post".
  const bodyLineOne =
    input.updatedCount === 1
      ? `Kelsey made the changes you asked for on ${safeCount} post — have a look at the new version when you have a minute, and approve it or ask for more changes.`
      : `Kelsey made the changes you asked for on ${safeCount} posts — have a look at the new versions when you have a few minutes, and approve each one or ask for more changes.`;

  return buildShell({
    titleTag: buildContentRereleaseEmailSubject(
      input.monthName,
      input.updatedCount
    ),
    // Deck rows "Heading" and "Heading, one post". Raw — the shell escapes it.
    headline:
      input.updatedCount === 1
        ? `Kelsey updated one of your ${input.monthName} posts`
        : `Kelsey updated your ${input.monthName} posts`,
    preheader: `${updatedCountLabel(input.updatedCount)} · reviews open through ${input.deadlineLabel}`,
    bodyParagraph: bodyLineOne,
    // Verbatim Screen 8's line 2 — the same function, so the same bytes.
    extraBodyHtml: deadlineBodyLineHtml(input.deadlineLabel),
    portalUrl: input.reviewUrl,
    recipientName: firstNameOf(input.recipientName),
    buttonLabel: "Review the updates",
  });
}
