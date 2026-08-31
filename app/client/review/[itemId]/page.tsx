import Link from "next/link";
import { notFound } from "next/navigation";
import {
  monthDayLabelForDateKey,
  weekdayDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { requireCurrentClient } from "@/lib/currentClient";
import { ApprovedState } from "../_components/ApprovedState";
import { PostActions } from "../_components/PostActions";
import { PostMedia } from "../_components/PostMedia";
import { WithKelseyState } from "../_components/WithKelseyState";
import {
  BACK_LINK,
  CAPTION_LABEL,
  positionLabel,
  requestChangesContext,
  scheduledLine,
} from "../_lib/copy";
import {
  needsClientReview,
  platformLabel,
  shortWeekdayDateLabelForDateKey,
} from "../_lib/format";
import {
  fetchMyReviewItems,
  fetchMyReviewableCycleForItem,
  fetchMySubmittedRound,
} from "../_lib/queries";
import { buildReviewSlides } from "../_lib/slides";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ itemId: string }>;
}

/**
 * One post (copy deck Screen 2), with Approve.
 *
 * A ROUTE, NOT A PANEL. The deck's "All posts" back link and "Next post"
 * action both assume a URL per post, and a routed post is also what makes the
 * queue resumable in the browser's own terms - a client can bookmark, share
 * with a business partner, or hit back without the surface losing its place.
 *
 * EVERY "NO" IS A 404. Not yours, does not exist, still a draft, or in a month
 * that is not open for review - all of them render the same not-found page, so
 * nothing distinguishes "someone else's post" from "no such post".
 */
export default async function ClientReviewItemPage({ params }: PageProps) {
  const { itemId } = await params;
  const client = await requireCurrentClient();

  // Ownership AND release state in one call. A client owns their unreleased
  // posts too, so this returning null covers a bookmarked URL from a month
  // Kelsey has since pulled back.
  const cycle = await fetchMyReviewableCycleForItem(client.id, itemId);
  if (!cycle) notFound();

  // The whole queue, because the page needs the post's place in it: "Post 5 of
  // 12" and the "Next post" link are both positional. Twenty-odd rows, already
  // ordered - cheaper than three separate count and neighbour queries.
  const items = await fetchMyReviewItems(client.id, cycle.id);
  const index = items.findIndex((candidate) => candidate.id === itemId);
  // Not in the list means the item is still 'draft' - Kelsey added it after
  // release and has not released again. Same 404 as everything else.
  if (index === -1) notFound();

  const item = items[index];
  const slides = await buildReviewSlides(item.assets);

  // The sent round, for the locked state's readback. Fetched only when the
  // status says one exists; a null result on a changes_requested item is a
  // half-written state the standing read rule makes invisible — the page
  // renders no state block rather than an empty receipt.
  const submitted =
    item.status === "changes_requested"
      ? await fetchMySubmittedRound(client.id, item.id)
      : null;

  const scheduledKey = dateKeyInTimezone(new Date(item.scheduled_for));
  const goesOutWeekday = weekdayDateLabelForDateKey(scheduledKey);
  const goesOutBare = monthDayLabelForDateKey(scheduledKey);

  const next = items[index + 1];
  const nextHref = next ? `/client/review/${next.id}` : null;

  return (
    <section>
      <Link href="/client/review" style={backLinkStyle}>
        <span aria-hidden="true" style={{ marginRight: 6 }}>
          ‹
        </span>
        {BACK_LINK}
      </Link>

      <p className="eyebrow" style={{ margin: "16px 0 0" }}>
        {positionLabel(index + 1, items.length)}
      </p>

      <div className="rvw-layout">
        <div className="rvw-media-col">
          <PostMedia slides={slides} />
        </div>

        <div className="rvw-detail-col">
          <p style={scheduledStyle}>
            {scheduledLine(
              goesOutWeekday,
              platformLabel(item.platform, item.format)
            )}
          </p>

          <div style={captionBlockStyle}>
            <p className="eyebrow" style={{ margin: 0 }}>
              {CAPTION_LABEL}
            </p>
            <p style={captionStyle}>{item.caption?.trim() || "—"}</p>
          </div>

          {needsClientReview(item.status) && (
            <PostActions
              itemId={item.id}
              goesOutLabel={goesOutWeekday}
              contextLine={requestChangesContext(
                shortWeekdayDateLabelForDateKey(scheduledKey),
                platformLabel(item.platform, item.format)
              )}
              hasVideo={item.assets.some((asset) => asset.kind === "video")}
            />
          )}

          {/* The locked state (Screen 5, "With Kelsey"): the item was sent
              and cannot be reopened — the state block IS the lock's face, a
              receipt of what they asked for rather than a wall. No actions,
              no message link (spec §5.4/§5.6). */}
          {submitted?.round.submitted_at && (
            <WithKelseyState
              sentLabel={weekdayDateLabelForDateKey(
                dateKeyInTimezone(new Date(submitted.round.submitted_at))
              )}
              notes={submitted.notes}
            />
          )}

          {(item.status === "approved" || item.status === "published") &&
            item.approved_at && (
              <ApprovedState
                approvedLabel={weekdayDateLabelForDateKey(
                  dateKeyInTimezone(new Date(item.approved_at))
                )}
                goesOutLabel={goesOutBare}
                nextHref={nextHref}
              />
            )}
        </div>
      </div>

      {/* Single column on a phone; media beside the details from 900px, the
          same breakpoint the owner-side player uses. A 9:16 frame in one
          column on a laptop would push Approve below the fold, which on the
          one screen where a client has a decision to make is the wrong place
          to put the decision. */}
      <style>{`
        .rvw-layout {
          display: flex;
          flex-direction: column;
          gap: 20px;
          margin-top: 16px;
        }
        .rvw-detail-col {
          min-width: 0;
        }
        @media (min-width: 900px) {
          .rvw-layout {
            flex-direction: row;
            align-items: flex-start;
            gap: 32px;
          }
          .rvw-media-col {
            flex: 0 0 auto;
          }
          .rvw-detail-col {
            flex: 1 1 auto;
            max-width: 52ch;
          }
        }
      `}</style>
    </section>
  );
}

const backLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 48,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.04em",
  color: "var(--accent)",
};

const scheduledStyle = {
  margin: 0,
  fontSize: 14,
  color: "var(--text-body)",
};

const captionBlockStyle = {
  margin: "16px 0",
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const captionStyle = {
  margin: "8px 0 0",
  fontSize: 15,
  lineHeight: 1.6,
  color: "var(--text-primary)",
  whiteSpace: "pre-wrap" as const,
  overflowWrap: "anywhere" as const,
};
