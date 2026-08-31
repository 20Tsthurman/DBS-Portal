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
 * Every string is from `docs/DBS_Content_Approval_Copy_Deck.md` Screen 8.
 * Nothing here may be reworded at build time.
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
  const safeDeadline = escapeHtml(input.deadlineLabel);
  const safeCount = escapeHtml(postCountLabel(input.postCount));

  // Two shapes, because "1 posts ... approve each one" is broken English and
  // this is the surface a client reads first. Deck rows: "Body, line 1" and
  // "Body, line 1, one post".
  const bodyLineOne =
    input.postCount === 1
      ? `Kelsey has ${safeCount} ready for your review — take a look when you have a minute, and approve it or ask for changes.`
      : `Kelsey has ${safeCount} ready for your review — take a look when you have a few minutes, and approve each one or ask for changes.`;

  // Line 2 rides in `extraBodyHtml` rather than being concatenated into line
  // 1: the shell wraps `bodyParagraph` in a single <p>, and two sentences of
  // different purpose in one paragraph is not what the deck draws. Margins
  // match the shell's own body paragraph so the two read as one column.
  const bodyLineTwo = `<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4B5C4E;font-family:'DM Sans',Arial,sans-serif;">Reviews are open through ${safeDeadline}. ${escapeHtml(
    DEADLINE_AUTO_APPROVE_SENTENCE
  )}</p>`;

  return buildShell({
    titleTag: buildContentReleaseEmailSubject(input.monthName),
    // Raw, not pre-escaped: `buildShell` escapes `headline`, `titleTag`,
    // `preheader` and `buttonLabel` itself. Only `bodyParagraph` is assigned
    // raw, so only the two body lines are escaped above.
    headline: `Your ${input.monthName} content is ready`,
    preheader: `${postCountLabel(input.postCount)} · reviews open through ${input.deadlineLabel}`,
    bodyParagraph: bodyLineOne,
    extraBodyHtml: bodyLineTwo,
    portalUrl: input.reviewUrl,
    // The shell renders "Hi <recipientName>," — the deck's greeting is a first
    // name ("Hi Renee,"), so it is trimmed here rather than in the shell.
    recipientName: firstNameOf(input.recipientName),
    buttonLabel: "Review your posts",
  });
}
