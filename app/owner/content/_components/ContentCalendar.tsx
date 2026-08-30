"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { MonthGrid } from "@/app/owner/calendar/_components/MonthGrid";
import { formatShortTimeInTimezone } from "@/app/owner/calendar/_lib/timezone";
import { FORMAT_LABELS, PLATFORM_LABELS } from "../_lib/format";
import { contentHref } from "../_lib/href";
import type { ContentCalendarEvent } from "../_lib/calendarEvents";

interface ContentCalendarProps {
  monthKey: string;
  /** null = all-clients view. Preserved in the day links so list view keeps the filter. */
  clientId: string | null;
  /** Already sorted by scheduled_for (the fetch orders it) — the grid preserves order. */
  events: ContentCalendarEvent[];
  /** Opens the item editor panel — the board owns the panel state. */
  onEditItem: (itemId: string) => void;
}

/**
 * Month grid of post pills — Kelsey's building surface.
 *
 * Each post is a horizontal pill: a 12px-wide 9:16 thumbnail strip on the
 * left (true aspect, never cropped square — the house rule), then a
 * truncating text line — time plus format when filtered to one client, time
 * plus client name across all clients. Border width, text size/weight, and
 * truncation mirror `MonthEventPill` so the two calendars read as one
 * family; full detail stays in the title/aria-label tooltip.
 *
 * Desktop stacks up to MAX_VISIBLE_PILLS pills then a "+N more" line, the
 * owner calendar's convention. Mobile day cells are ~50px wide, so only the
 * first post's pill shows, collapsed to border + thumbnail strip (no text),
 * with a "+N" count beside it.
 *
 * Clicking a pill opens the item editor. The "+N more" line, the mobile
 * count, and a cell's empty area all go to the LIST view anchored to that
 * day — the content calendar has no DayPanel and the list is the day-detail
 * surface here.
 *
 * No approval-state chrome: everything is `drafting` until release exists
 * (Phase 4). The only states drawn are media states — a processing video is
 * a muted strip (text still shows), a failed upload swaps the accent left
 * border for danger.
 */
export function ContentCalendar({
  monthKey,
  clientId,
  events,
  onEditItem,
}: ContentCalendarProps) {
  const dayHref = (dateKey: string) =>
    `${contentHref({ monthKey, clientId, view: "list" })}#day-${dateKey}`;

  return (
    <MonthGrid
      monthKey={monthKey}
      events={events}
      dayHref={dayHref}
      renderDayContent={(dayEvents, day) => {
        const visible = dayEvents.slice(0, MAX_VISIBLE_PILLS);
        const desktopOverflow = dayEvents.length - MAX_VISIBLE_PILLS;
        const mobileOverflow = dayEvents.length - 1;
        return (
          <div style={pillColumnStyle}>
            {visible.map((e, i) => (
              <div
                key={e.id}
                // Row 0 carries the mobile presence (strip-only pill plus
                // the "+N" count); rows 1+ are desktop-only.
                className={
                  i === 0
                    ? "flex items-center gap-1"
                    : "hidden lg:flex lg:items-center"
                }
              >
                <button
                  type="button"
                  onClick={() => onEditItem(e.itemId)}
                  title={pillTooltip(e)}
                  aria-label={pillTooltip(e)}
                  className="flex-1 min-w-0"
                  style={pillStyle(e)}
                >
                  <span style={stripStyle(e)}>
                    {e.thumb?.url && (
                      // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL; next/image can't optimize it and would leak it to the optimizer route
                      <img src={e.thumb.url} alt="" style={stripImgStyle} />
                    )}
                  </span>
                  <span className="hidden lg:block" style={pillTextStyle}>
                    <span style={{ opacity: 0.75, marginRight: 4 }}>
                      {formatShortTimeInTimezone(e.scheduledFor)} ·
                    </span>
                    <span>
                      {clientId ? FORMAT_LABELS[e.format] : e.clientName}
                    </span>
                  </span>
                </button>
                {i === 0 && mobileOverflow > 0 && (
                  <Link
                    href={day.href}
                    className="lg:hidden"
                    aria-label={`${mobileOverflow} more ${
                      mobileOverflow === 1 ? "post" : "posts"
                    } on ${day.dateKey}`}
                    style={mobileBadgeStyle}
                  >
                    +{mobileOverflow}
                  </Link>
                )}
              </div>
            ))}
            {desktopOverflow > 0 && (
              <Link
                href={day.href}
                className="hidden lg:block"
                aria-label={`${desktopOverflow} more ${
                  desktopOverflow === 1 ? "post" : "posts"
                } on ${day.dateKey}`}
                style={overflowLinkStyle}
              >
                +{desktopOverflow} more
              </Link>
            )}
          </div>
        );
      }}
    />
  );
}

// Same count as the owner calendar's MonthView (MAX_VISIBLE_PILLS = 3): these
// pills are ~21px tall vs its 18px, close enough that three plus the "+N
// more" line lands at about the same cell height.
const MAX_VISIBLE_PILLS = 3;

function pillTooltip(e: ContentCalendarEvent): string {
  const parts = [
    formatShortTimeInTimezone(e.scheduledFor),
    e.clientName,
    `${PLATFORM_LABELS[e.platform]} ${FORMAT_LABELS[e.format]}`,
  ];
  if (e.thumb?.status === "processing") parts.push("video processing");
  if (e.thumb?.status === "failed") parts.push("upload failed");
  return parts.join(" · ");
}

const pillColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
  position: "relative",
  zIndex: 2,
};

function pillStyle(e: ContentCalendarEvent): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    padding: 0,
    border: "none",
    borderLeft:
      e.thumb?.status === "failed"
        ? "3px solid var(--status-danger)"
        : "3px solid var(--accent)",
    backgroundColor: "var(--surface-raised)",
    overflow: "hidden",
    cursor: "pointer",
    textAlign: "left",
  };
}

function stripStyle(e: ContentCalendarEvent): CSSProperties {
  return {
    // True 9:16 at strip scale; a null thumb URL still draws an occupied
    // slot in surface-base against the pill's raised background.
    display: "block",
    width: 12,
    aspectRatio: "9 / 16",
    flexShrink: 0,
    overflow: "hidden",
    backgroundColor: "var(--surface-base)",
    opacity: e.thumb?.status === "processing" ? 0.5 : 1,
  };
}

const stripImgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

// Desktop-only, so the fixed values match MonthEventPill's lg tier:
// text-[11px], weight 500, pl-1.5 pr-1, nowrap + ellipsis.
const pillTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  paddingLeft: 6,
  paddingRight: 4,
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-primary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const mobileBadgeStyle: CSSProperties = {
  flexShrink: 0,
  padding: "1px 4px",
  fontSize: 10,
  fontWeight: 600,
  lineHeight: "14px",
  backgroundColor: "var(--surface-base)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  textDecoration: "none",
};

// Mirrors MonthView's overflow link so the two calendars' "+N more" rows match.
const overflowLinkStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
  padding: "0 6px",
  lineHeight: "16px",
  textDecoration: "none",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
