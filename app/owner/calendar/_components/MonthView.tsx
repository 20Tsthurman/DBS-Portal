import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import {
  dateKeyInMonth,
  monthGridDateKeys,
} from "../_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
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
          const visible = dayEvents.slice(0, MAX_VISIBLE_PILLS);
          const overflow = dayEvents.length - visible.length;
          const col = idx % 7;
          const row = Math.floor(idx / 7);
          const dayHref = `/owner/calendar?view=month&month=${monthKey}&date=${dk}`;

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
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontWeight: 700,
  // globals.css enforces no border-radius; matching the square treatment in WeekView.
};
