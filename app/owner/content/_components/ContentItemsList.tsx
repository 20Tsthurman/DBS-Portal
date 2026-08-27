"use client";

import type { CSSProperties } from "react";
import { MobileCardList } from "@/components/ui/MobileCard";
import { dateKeyInTimezone } from "@/lib/date";
import { fullDateLabelForDateKey } from "@/app/owner/calendar/_lib/timezone";
import { ContentItemRow } from "./ContentItemRow";
import { ContentItemCard } from "./ContentItemCard";
import type { ContentItemWithAssets } from "../_lib/queries";

interface ContentItemsListProps {
  items: ContentItemWithAssets[];
  showClient: boolean;
  onEdit: (item: ContentItemWithAssets) => void;
  onDelete: (item: ContentItemWithAssets) => void;
}

interface DateGroup {
  dateKey: string;
  items: ContentItemWithAssets[];
}

/**
 * Bucket items by their PORTAL_TIMEZONE day. `scheduled_for` is a UTC
 * instant, so a late-evening Central post would land on the following day if
 * bucketed off the raw Date — `dateKeyInTimezone` is the helper that exists
 * precisely for this boundary.
 *
 * Input is already ordered by `scheduled_for` ascending, so groups come out
 * chronological without a second sort.
 */
function groupByDate(items: ContentItemWithAssets[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const item of items) {
    const dateKey = dateKeyInTimezone(new Date(item.scheduled_for));
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dateKey) last.items.push(item);
    else groups.push({ dateKey, items: [item] });
  }
  return groups;
}

/**
 * Grouped-by-date list. Repeats the desktop-table / mobile-card split the
 * invoices table established: a real `<table>` inside `hidden lg:block`, and
 * `MobileCardList` inside `lg:hidden`.
 */
export function ContentItemsList({
  items,
  showClient,
  onEdit,
  onDelete,
}: ContentItemsListProps) {
  if (items.length === 0) {
    return (
      <div style={emptyStateStyle}>
        <p style={{ margin: 0 }}>No posts in this month yet.</p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
          Add one to start building the month.
        </p>
      </div>
    );
  }

  const groups = groupByDate(items);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.dateKey}>
          <h2 style={dateHeadingStyle}>
            {fullDateLabelForDateKey(group.dateKey)}
          </h2>

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
                  <th>Time</th>
                  {showClient && <th>Client</th>}
                  <th>Platform</th>
                  <th>Format</th>
                  <th>Caption</th>
                  <th>Photos</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }} aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <ContentItemRow
                    key={item.id}
                    item={item}
                    showClient={showClient}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <MobileCardList className="lg:hidden">
            {group.items.map((item) => (
              <ContentItemCard
                key={item.id}
                item={item}
                showClient={showClient}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </MobileCardList>
        </section>
      ))}
    </div>
  );
}

const dateHeadingStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 15,
  fontWeight: 500,
  color: "var(--text-primary)",
  marginBottom: 10,
  paddingBottom: 6,
  borderBottom: "1px solid var(--border)",
};

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-body)",
  fontSize: 14,
};
