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
 * Month grid of 9:16 post thumbnails — Kelsey's building surface.
 *
 * The layout problem this solves: a day cell is short and wide, the media is
 * tall and narrow, and the house rule says media is NEVER cropped square.
 * So tiles keep the true 9:16 aspect and the cell's height is the
 * constraint: on desktop a row of up to four 56px-tall tiles plus a "+N"
 * overflow tile; on mobile one full-cell-width tile with a "+N" count badge
 * (three tiles across a 50px phone cell would be unreadable smudges).
 *
 * Clicking a tile opens the item editor. Clicking the "+N" overflow, the
 * badge, or a cell's empty area goes to the LIST view anchored to that day —
 * the content calendar has no DayPanel and the list is the day-detail
 * surface here.
 *
 * No approval-state chrome: everything is `drafting` until release exists
 * (Phase 4). The only states drawn are media states — a processing video is
 * a muted occupied slot, a failed one gets a danger border.
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
        const visible = dayEvents.slice(0, MAX_DESKTOP_TILES);
        const desktopOverflow = dayEvents.length - MAX_DESKTOP_TILES;
        const mobileOverflow = dayEvents.length - 1;
        return (
          <div style={tileRowStyle}>
            {visible.map((e, i) => (
              <div
                key={e.id}
                // Tile 0 carries the mobile presence; tiles 1–3 are
                // desktop-only. Width: full cell on mobile, derived from
                // aspect-ratio × 56px height on desktop.
                className={
                  i === 0 ? "w-full lg:w-auto lg:h-14" : "hidden lg:block lg:h-14"
                }
                style={tileFrameStyle(e)}
              >
                <button
                  type="button"
                  onClick={() => onEditItem(e.itemId)}
                  title={tileTooltip(e)}
                  aria-label={tileTooltip(e)}
                  style={tileButtonStyle}
                >
                  {e.thumb?.url && (
                    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL; next/image can't optimize it and would leak it to the optimizer route
                    <img src={e.thumb.url} alt="" style={tileImgStyle} />
                  )}
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
                className="hidden lg:flex lg:h-14"
                aria-label={`${desktopOverflow} more ${
                  desktopOverflow === 1 ? "post" : "posts"
                } on ${day.dateKey}`}
                style={overflowTileStyle}
              >
                +{desktopOverflow}
              </Link>
            )}
          </div>
        );
      }}
    />
  );
}

const MAX_DESKTOP_TILES = 4;

function tileTooltip(e: ContentCalendarEvent): string {
  const parts = [
    formatShortTimeInTimezone(e.scheduledFor),
    e.clientName,
    `${PLATFORM_LABELS[e.platform]} ${FORMAT_LABELS[e.format]}`,
  ];
  if (e.thumb?.status === "processing") parts.push("video processing");
  if (e.thumb?.status === "failed") parts.push("upload failed");
  return parts.join(" · ");
}

const tileRowStyle: CSSProperties = {
  display: "flex",
  gap: 2,
  minWidth: 0,
  position: "relative",
  zIndex: 2,
};

function tileFrameStyle(e: ContentCalendarEvent): CSSProperties {
  return {
    // True 9:16, never cropped: the frame matches the media's aspect, so
    // object-fit cover below shows the full frame.
    aspectRatio: "9 / 16",
    flexShrink: 0,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "var(--surface-raised)",
    border:
      e.thumb?.status === "failed"
        ? "1px solid var(--status-danger)"
        : "1px solid var(--border)",
  };
}

const tileButtonStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const tileImgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const mobileBadgeStyle: CSSProperties = {
  position: "absolute",
  right: 2,
  bottom: 2,
  zIndex: 2,
  padding: "1px 4px",
  fontSize: 10,
  fontWeight: 600,
  lineHeight: "14px",
  backgroundColor: "var(--surface-base)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  textDecoration: "none",
};

const overflowTileStyle: CSSProperties = {
  aspectRatio: "9 / 16",
  flexShrink: 0,
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-muted)",
  textDecoration: "none",
};
