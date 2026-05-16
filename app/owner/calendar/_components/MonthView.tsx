import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import {
  dateKeyInMonth,
  dateKeyInTimezone,
  monthGridDateKeys,
} from "../_lib/timezone";
import { MonthEventPill } from "./MonthEventPill";

interface MonthViewProps {
  /** YYYY-MM of the displayed month. */
  monthKey: string;
  events: CalendarEvent[];
  /** Optional override for "now" — primarily for testing. Defaults to `new Date()`. */
  now?: Date;
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MAX_VISIBLE_PILLS = 3;
const CELL_MIN_HEIGHT = 96;

export function MonthView({ monthKey, events, now = new Date() }: MonthViewProps) {
  const grid = monthGridDateKeys(monthKey);
  const todayKey = dateKeyInTimezone(now);

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.dateKey);
    if (list) list.push(e);
    else eventsByDay.set(e.dateKey, [e]);
  }
  // Each day already sorted upstream by startsAt — preserve it.

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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--surface-base)",
        }}
      >
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            style={{
              padding: "10px 12px",
              borderRight: i < 6 ? "1px solid var(--border)" : undefined,
              fontSize: 10,
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: `minmax(${CELL_MIN_HEIGHT}px, auto)`,
        }}
      >
        {grid.map((dk, idx) => {
          const inMonth = dateKeyInMonth(dk, monthKey);
          const isToday = dk === todayKey;
          const dayNum = Number(dk.slice(8, 10));
          const dayEvents = eventsByDay.get(dk) ?? [];
          const visible = dayEvents.slice(0, MAX_VISIBLE_PILLS);
          const overflow = dayEvents.length - visible.length;
          const col = idx % 7;
          const row = Math.floor(idx / 7);
          const dayHref = `/owner/calendar?view=month&month=${monthKey}&date=${dk}`;

          return (
            <div
              key={dk}
              style={{
                position: "relative",
                minHeight: CELL_MIN_HEIGHT,
                borderRight: col < 6 ? "1px solid var(--border)" : undefined,
                borderBottom: row < 5 ? "1px solid var(--border)" : undefined,
                backgroundColor: inMonth ? "var(--surface-base)" : "var(--surface-raised)",
                outline: isToday ? "2px solid var(--accent)" : undefined,
                outlineOffset: isToday ? "-2px" : undefined,
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "hidden",
              }}
            >
              {/* Empty-area click target — opens the day panel. */}
              <Link
                href={dayHref}
                aria-label={`Open ${dk}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 0,
                }}
              />

              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  padding: "2px 4px",
                  zIndex: 2,
                  pointerEvents: "none",
                }}
              >
                {isToday ? (
                  <span style={todayMarkerStyle}>{dayNum}</span>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: inMonth ? "var(--text-primary)" : "var(--text-muted)",
                      opacity: inMonth ? 1 : 0.6,
                    }}
                  >
                    {dayNum}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  position: "relative",
                  zIndex: 2,
                }}
              >
                {visible.map((e) => (
                  <MonthEventPill key={e.id} event={e} monthKey={monthKey} />
                ))}
                {overflow > 0 && (
                  <Link
                    href={dayHref}
                    style={{
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
                    }}
                  >
                    +{overflow} more
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const todayMarkerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: 700,
  // globals.css enforces no border-radius; matching the square treatment in WeekView.
};
