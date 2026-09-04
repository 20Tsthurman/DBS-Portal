import {
  currentMonthKey,
  formatMonthLabel,
  monthNameForMonthKey,
  weekdayDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { requireCurrentClient } from "@/lib/currentClient";
import { CycleClosedBanner } from "./_components/CycleClosedBanner";
import { DeadlineCard } from "./_components/DeadlineCard";
import { NoCycleState, type RecapSummary } from "./_components/NoCycleState";
import { QueueSummary } from "./_components/QueueSummary";
import { ReviewQueue } from "./_components/ReviewQueue";
import { WorkingState } from "./_components/WorkingState";
import { NAV_LABEL, QUEUE_INSTRUCTION, queueTitle } from "./_lib/copy";
import {
  countMyCycleItems,
  fetchMyActiveCycle,
  fetchMyDeniedItemIds,
  fetchMyLastClosedCycle,
  fetchMyReviewItems,
} from "./_lib/queries";
import { needsClientReview, wasAutoApproved } from "./_lib/format";
import { buildReviewThumbUrls } from "./_lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * The client's review queue (spec §5.2, copy deck Screens 1, 6 and 7).
 *
 * THE QUEUE IS RESUMABLE BY CONSTRUCTION. There is no progress table and no
 * cursor: "where they left off" is just which items are still 'in_review'.
 * A client can review three posts, close the tab for a week, and come back to
 * a page that has already accounted for what they did — because the only
 * record of it is the item rows themselves.
 *
 * There is no global submit and no approve-all, here or anywhere. Per-item
 * action is the mechanism the whole design rests on (spec §5.4).
 *
 * THREE SHAPES, one query deciding between them (`fetchMyActiveCycle`):
 * a month in review is Screen 1; a month that closed and is still this
 * month is Screen 6, the same list read-only under a banner saying how it
 * closed; and nothing visible is Screen 7, with the last closed month's
 * recap card. The month boundary between 6 and 7 was decided 2026-09-04 and
 * lives in the query, not here.
 *
 * Server component end to end, no client JS: everything on this page is text
 * and links.
 */
export default async function ClientReviewPage() {
  const client = await requireCurrentClient();
  const cycle = await fetchMyActiveCycle(client.id, currentMonthKey());

  if (!cycle) {
    // Nothing out for review. Either this client has never had a month
    // released, or the last one closed — the recap card is what separates
    // "nothing yet" from "between months" (spec §5.9). Its date is the day
    // reviews actually closed, which is not the deadline on an early lock.
    const closed = await fetchMyLastClosedCycle(client.id);
    let recap: RecapSummary | null = null;
    if (closed) {
      recap = {
        monthKey: closed.month.slice(0, 7),
        postCount: await countMyCycleItems(client.id, closed.id),
        closedAt: closed.locked_at ?? closed.revision_deadline,
      };
    }
    return (
      <section>
        <Header eyebrow={null} title={null} />
        <NoCycleState recap={recap} />
      </section>
    );
  }

  const monthKey = cycle.month.slice(0, 7);
  const monthName = monthNameForMonthKey(monthKey);
  const items = await fetchMyReviewItems(client.id, cycle.id);
  const thumbUrls = await buildReviewThumbUrls(items);
  const deniedIds = await fetchMyDeniedItemIds(items.map((item) => item.id));

  if (cycle.status === "locked") {
    // Screen 6, closed. No instruction line, no deadline card, no count —
    // there is nothing left for the client to do, and the banner says what
    // happened instead. The list stays, pills and all, because a client
    // still wants to see what is going out; every row's action reads View.
    //
    // The banner's two counts follow the deck's rule (2026-09-02): what the
    // client approved and what the lock approved, and nothing else — a post
    // still with Kelsey, or one she kept as planned, is neither.
    const endedAt = cycle.locked_at ?? cycle.revision_deadline;
    const endedLabel = endedAt
      ? weekdayDateLabelForDateKey(dateKeyInTimezone(new Date(endedAt)))
      : null;
    const settled = items.filter(
      (item) => item.status === "approved" || item.status === "published"
    );
    const autoCount = settled.filter(wasAutoApproved).length;
    const approvedCount = settled.length - autoCount;

    return (
      <section>
        <Header
          eyebrow={formatMonthLabel(monthKey)}
          title={queueTitle(monthName)}
          instruction={false}
        />
        <CycleClosedBanner
          lockedBy={cycle.locked_by}
          monthName={monthName}
          endedLabel={endedLabel}
          approvedCount={approvedCount}
          autoCount={autoCount}
        />
        <ReviewQueue items={items} thumbUrls={thumbUrls} deniedIds={deniedIds} />
      </section>
    );
  }

  const remaining = items.filter((item) =>
    needsClientReview(item.status)
  ).length;
  // The 2026-08-31 counting rule (deck, Screen 1 notes): a denied request
  // counts as neither changes-in-flight nor approved. `changedCount` feeds
  // the Working state's body, so it holds only what Kelsey is actually
  // working on — the Working state does not render when every request was
  // denied, because nothing is coming.
  const changedCount = items.filter(
    (item) =>
      item.status === "changes_requested" && !deniedIds.has(item.id)
  ).length;
  const hasChangesRequested = changedCount > 0;
  const hasDenied = items.some(
    (item) => item.status === "changes_requested" && deniedIds.has(item.id)
  );

  const deadlineLabel = cycle.revision_deadline
    ? weekdayDateLabelForDateKey(
        dateKeyInTimezone(new Date(cycle.revision_deadline))
      )
    : null;

  return (
    <section>
      <Header eyebrow={formatMonthLabel(monthKey)} title={queueTitle(monthName)} />

      {/* A released cycle always has a deadline — the release gate refuses one
          without it — so this is a guard, not a designed state. There is no
          copy for a deadline-less queue and none should be invented; the card
          is simply absent. */}
      {deadlineLabel && <DeadlineCard deadlineLabel={deadlineLabel} />}

      <QueueSummary
        total={items.length}
        remaining={remaining}
        hasChangesRequested={hasChangesRequested}
        hasDenied={hasDenied}
        monthName={monthName}
      />

      {/* Screen 6's Working state supersedes the all-handled banner whenever
          any post has changes IN FLIGHT (ruling 2026-08-31) — QueueSummary
          holds its banner back in exactly this case. Denied requests don't
          count (the counting rule): with only denials left, the banner's
          all-denied variant renders instead of a Working state promising work
          that isn't coming. Cycle-level, so this is the only home of the
          "Forgot something?" escape hatch (spec §5.6). */}
      {remaining === 0 && hasChangesRequested && (
        <WorkingState changedCount={changedCount} />
      )}

      <ReviewQueue items={items} thumbUrls={thumbUrls} deniedIds={deniedIds} />
    </section>
  );
}

/**
 * The page heading. The no-cycle states carry their own title inside the
 * panel, so this renders the generic nav label there instead of naming a month
 * that does not exist. A closed month keeps its title and drops the
 * instruction line — "approve it, or ask for changes" is not on offer.
 */
function Header({
  eyebrow,
  title,
  instruction = true,
}: {
  eyebrow: string | null;
  title: string | null;
  instruction?: boolean;
}) {
  return (
    <header style={{ marginBottom: 24 }}>
      {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
      <h1 className="page-title">{title ?? NAV_LABEL}</h1>
      {title && instruction && (
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-body)" }}>
          {QUEUE_INSTRUCTION}
        </p>
      )}
    </header>
  );
}
