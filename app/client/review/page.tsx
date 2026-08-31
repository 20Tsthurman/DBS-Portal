import {
  formatMonthLabel,
  monthNameForMonthKey,
  weekdayDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { requireCurrentClient } from "@/lib/currentClient";
import { DeadlineCard } from "./_components/DeadlineCard";
import { NoCycleState, type RecapSummary } from "./_components/NoCycleState";
import { QueueSummary } from "./_components/QueueSummary";
import { ReviewQueue } from "./_components/ReviewQueue";
import { WorkingState } from "./_components/WorkingState";
import { NAV_LABEL, QUEUE_INSTRUCTION, queueTitle } from "./_lib/copy";
import {
  countMyCycleItems,
  fetchMyActiveCycle,
  fetchMyLastClosedCycle,
  fetchMyReviewItems,
} from "./_lib/queries";
import { needsClientReview } from "./_lib/format";
import { buildReviewThumbUrls } from "./_lib/thumbs";

export const dynamic = "force-dynamic";

/**
 * The client's review queue (spec §5.2, copy deck Screens 1 and 7).
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
 * Server component end to end, no client JS: everything on this page is text
 * and links.
 */
export default async function ClientReviewPage() {
  const client = await requireCurrentClient();
  const cycle = await fetchMyActiveCycle(client.id);

  if (!cycle) {
    // Nothing out for review. Either this client has never had a month
    // released, or the last one closed — the recap card is what separates
    // "nothing yet" from "between months" (spec §5.9).
    const closed = await fetchMyLastClosedCycle(client.id);
    let recap: RecapSummary | null = null;
    if (closed) {
      recap = {
        monthKey: closed.month.slice(0, 7),
        postCount: await countMyCycleItems(client.id, closed.id),
        closedAt: closed.revision_deadline,
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

  const remaining = items.filter((item) =>
    needsClientReview(item.status)
  ).length;
  const changedCount = items.filter(
    (item) => item.status === "changes_requested"
  ).length;
  const hasChangesRequested = changedCount > 0;

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
        monthName={monthName}
      />

      {/* Screen 6's Working state supersedes the all-handled banner whenever
          any post has changes sent (ruling 2026-08-31) — QueueSummary holds
          its banner back in exactly this case. Cycle-level, so this is the
          only home of the "Forgot something?" escape hatch (spec §5.6). */}
      {remaining === 0 && hasChangesRequested && (
        <WorkingState changedCount={changedCount} />
      )}

      <ReviewQueue items={items} thumbUrls={thumbUrls} />
    </section>
  );
}

/**
 * The page heading. The no-cycle states carry their own title inside the
 * panel, so this renders the generic nav label there instead of naming a month
 * that does not exist.
 */
function Header({
  eyebrow,
  title,
}: {
  eyebrow: string | null;
  title: string | null;
}) {
  return (
    <header style={{ marginBottom: 24 }}>
      {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
      <h1 className="page-title">{title ?? NAV_LABEL}</h1>
      {title && (
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-body)" }}>
          {QUEUE_INSTRUCTION}
        </p>
      )}
    </header>
  );
}
