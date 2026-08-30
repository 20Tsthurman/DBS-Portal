import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  dateKeyInMonth,
  monthGridDateKeys,
} from "../_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

/**
 * The minimal event shape the month grid needs. The grid itself only buckets
 * by `dateKey` and keys children by `id`; every other field belongs to the
 * consumer's own event type and is seen only by its injected
 * `renderDayContent`. This is deliberate: `CalendarEvent` (owner calendar)
 * and `ContentCalendarEvent` (content calendar) render, link, and color
 * completely differently, so the grid stays agnostic of both.
 */
export interface MonthGridEvent {
  id: string;
  dateKey: string;
}

/** The cell context handed to `renderDayContent`. */
export interface MonthGridDay {
  /** YYYY-MM-DD of the cell being rendered. */
  dateKey: string;
  /** The injected day link — the same URL the empty-cell click target uses. */
  href: string;
}

interface MonthGridProps<E extends MonthGridEvent> {
  /** YYYY-MM of the displayed month. */
  monthKey: string;
  events: E[];
  /** Optional override for "now" — primarily for testing. Defaults to `new Date()`. */
  now?: Date;
  /** Builds the href for a day cell's empty-area click target. */
  dayHref: (dateKey: string) => string;
  /**
   * Renders a day's event area (pills, tiles, an overflow link…). Receives
   * the day's events in the order they arrived — sort upstream. Called for
   * every cell, so return a container even when `events` is empty.
   */
  renderDayContent: (events: E[], day: MonthGridDay) => ReactNode;
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Presentational 6×7 month grid: weekday header, day numbers, today outline,
 * in/out-of-month dimming, and a full-cell click target per day. Extracted
 * from `MonthView` in Phase 3 so the content calendar could reuse the layout;
 * `MonthView` remains the owner calendar's entry point and supplies the
 * pill renderer this component no longer knows about.
 */
export function MonthGrid<E extends MonthGridEvent>({
  monthKey,
  events,
  now = new Date(),
  dayHref,
  renderDayContent,
}: MonthGridProps<E>) {
  const grid = monthGridDateKeys(monthKey);
  const todayKey = dateKeyInTimezone(now);

  const eventsByDay = new Map<string, E[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.dateKey);
    if (list) list.push(e);
    else eventsByDay.set(e.dateKey, [e]);
  }
  // Each day already sorted upstream — preserve it.

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
      {/* Weekday header row */}
      <div
        className="grid grid-cols-7"
        style={{
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--surface-base)",
        }}
      >
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            className="px-1.5 py-1.5 text-[9px] lg:px-3 lg:py-2.5 lg:text-[10px]"
            style={{
              borderRight: i < 6 ? "1px solid var(--border)" : undefined,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* 6 rows × 7 columns */}
      <div className="grid grid-cols-7 auto-rows-[minmax(64px,auto)] lg:auto-rows-[minmax(96px,auto)]">
        {grid.map((dk, idx) => {
          const inMonth = dateKeyInMonth(dk, monthKey);
          const isToday = dk === todayKey;
          const dayNum = Number(dk.slice(8, 10));
          const dayEvents = eventsByDay.get(dk) ?? [];
          const col = idx % 7;
          const row = Math.floor(idx / 7);
          const href = dayHref(dk);

          return (
            <div
              key={dk}
              className="p-0.5 lg:p-1"
              style={{
                position: "relative",
                borderRight: col < 6 ? "1px solid var(--border)" : undefined,
                borderBottom: row < 5 ? "1px solid var(--border)" : undefined,
                backgroundColor: inMonth ? "var(--surface-base)" : "var(--surface-raised)",
                outline: isToday ? "2px solid var(--accent)" : undefined,
                outlineOffset: isToday ? "-2px" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "hidden",
              }}
            >
              {/* Empty-area click target — opens the injected day link. */}
              <Link
                href={href}
                aria-label={`Open ${dk}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 0,
                }}
              />

              <div
                className="px-1 py-0.5"
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  zIndex: 2,
                  pointerEvents: "none",
                }}
              >
                {isToday ? (
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 text-[11px] lg:w-6 lg:h-6 lg:text-xs"
                    style={todayMarkerStyle}
                  >
                    {dayNum}
                  </span>
                ) : (
                  <span
                    className="text-[11px] lg:text-xs"
                    style={{
                      fontWeight: 600,
                      color: inMonth ? "var(--text-primary)" : "var(--text-muted)",
                      opacity: inMonth ? 1 : 0.6,
                    }}
                  >
                    {dayNum}
                  </span>
                )}
              </div>

              {renderDayContent(dayEvents, { dateKey: dk, href })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const todayMarkerStyle: CSSProperties = {
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontWeight: 700,
  // globals.css enforces no border-radius; matching the square treatment in WeekView.
};
