import { MobileCardList } from "@/components/ui/MobileCard";
import { QueueCard } from "./QueueCard";
import { QueueRow } from "./QueueRow";
import { TABLE_HEADERS } from "../_lib/copy";
import type { ReviewItem } from "../_lib/queries";

interface ReviewQueueProps {
  items: ReviewItem[];
  thumbUrls: Map<string, string | null>;
}

/**
 * The month's posts: a real `<table>` at `lg` and up, `MobileCardList` below.
 * The split, and the primitives under it, are the house convention
 * (`InvoicesTable.tsx:49-97`, repeated by `ContentItemsList`).
 *
 * The dark header row is not styled here — `app/globals.css` paints
 * `table thead tr` with `--text-primary` and cream uppercase `th` for every
 * table in the app, so a plain `<thead>` inherits the deck's header band.
 *
 * A server component with no interactivity: every row is a `<Link>`. The queue
 * ships no client JavaScript, which on a phone on a weak connection is the
 * difference between a list that is there and a list that arrives.
 */
export function ReviewQueue({ items, thumbUrls }: ReviewQueueProps) {
  return (
    <>
      <div
        className="hidden lg:block"
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-raised)",
        }}
      >
        <table>
          <thead>
            <tr>
              <th>{TABLE_HEADERS.post}</th>
              <th>{TABLE_HEADERS.scheduled}</th>
              <th>{TABLE_HEADERS.platform}</th>
              <th>{TABLE_HEADERS.status}</th>
              <th style={{ textAlign: "right" }} aria-label="Open post" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <QueueRow
                key={item.id}
                item={item}
                positionInQueue={index + 1}
                thumbUrl={thumbUrls.get(item.id) ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>

      <MobileCardList className="lg:hidden">
        {items.map((item, index) => (
          <QueueCard
            key={item.id}
            item={item}
            positionInQueue={index + 1}
            thumbUrl={thumbUrls.get(item.id) ?? null}
          />
        ))}
      </MobileCardList>
    </>
  );
}
