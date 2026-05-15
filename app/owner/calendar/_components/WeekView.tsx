import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import {
  WEEK_GRID_END_HOUR,
  WEEK_GRID_HEIGHT_PX,
  WEEK_GRID_HOUR_PX,
  WEEK_GRID_START_HOUR,
  hourLabel,
} from "../_lib/dateMath";
import {
  addDaysToDateKey,
  dateKeyInTimezone,
  hourOfDayInTimezone,
  weekdayForDateKey,
} from "../_lib/timezone";
import { EventChip } from "./EventChip";

interface WeekViewProps {
  /** Sunday's YYYY-MM-DD in PORTAL_TIMEZONE. */
  weekStartKey: string;
  events: CalendarEvent[];
  /** Optional override for "now" — primarily for testing. Defaults to `new Date()`. */
  now?: Date;
}

const TIME_COL_PX = 56;
const HEADER_ROW_PX = 56;
const MIN_CHIP_HEIGHT = 32;
const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function WeekView({ weekStartKey, events, now = new Date() }: WeekViewProps) {
  const dayKeys: string[] = [];
  for (let i = 0; i < 7; i++) {
    dayKeys.push(addDaysToDateKey(weekStartKey, i));
  }

  const todayKey = dateKeyInTimezone(now);
  const todayColumnIndex = dayKeys.indexOf(todayKey);
  const nowHour = hourOfDayInTimezone(now);
  const showNowLine =
    todayColumnIndex !== -1 &&
    nowHour >= WEEK_GRID_START_HOUR &&
    nowHour < WEEK_GRID_END_HOUR;
  const nowLineTop =
    (nowHour - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.dateKey);
    if (list) list.push(e);
    else eventsByDay.set(e.dateKey, [e]);
  }

  const hourMarks: number[] = [];
  for (let h = WEEK_GRID_START_HOUR; h <= WEEK_GRID_END_HOUR; h++) {
    hourMarks.push(h);
  }
  const halfHourMarks: number[] = [];
  for (let h = WEEK_GRID_START_HOUR; h < WEEK_GRID_END_HOUR; h++) {
    halfHourMarks.push(h + 0.5);
  }

  const gridTemplate = `${TIME_COL_PX}px repeat(7, 1fr)`;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
      {/* Day headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          borderBottom: "1px solid var(--border)",
          height: HEADER_ROW_PX,
        }}
      >
        <div
          style={{
            borderRight: "1px solid var(--border)",
            backgroundColor: "var(--surface-base)",
          }}
        />
        {dayKeys.map((dk, i) => {
          const isToday = dk === todayKey;
          const dayNum = Number(dk.slice(8, 10));
          return (
            <div
              key={dk}
              style={{
                position: "relative",
                padding: "10px 12px",
                borderRight: i < 6 ? "1px solid var(--border)" : undefined,
                backgroundColor: "var(--surface-base)",
                outline: isToday ? "2px solid var(--accent)" : undefined,
                outlineOffset: isToday ? "-2px" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                {WEEKDAY_LABELS[weekdayForDateKey(dk)]}
              </div>
              {isToday ? (
                <span style={todayMarkerStyle}>{dayNum}</span>
              ) : (
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {dayNum}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridTemplate,
          position: "relative",
        }}
      >
        {/* Time axis column */}
        <div
          style={{
            position: "relative",
            height: WEEK_GRID_HEIGHT_PX,
            borderRight: "1px solid var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          {hourMarks.map((h) => {
            if (h === WEEK_GRID_END_HOUR) return null;
            const top = (h - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
            return (
              <div
                key={h}
                style={{
                  position: "absolute",
                  top,
                  left: 0,
                  right: 0,
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  padding: "4px 6px",
                  fontWeight: 600,
                }}
              >
                {hourLabel(h)}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {dayKeys.map((dk, i) => {
          const isToday = dk === todayKey;
          const dayEvents = eventsByDay.get(dk) ?? [];
          return (
            <div
              key={dk}
              style={{
                position: "relative",
                height: WEEK_GRID_HEIGHT_PX,
                borderRight: i < 6 ? "1px solid var(--border)" : undefined,
                backgroundColor: "var(--surface-base)",
                outline: isToday ? "2px solid var(--accent)" : undefined,
                outlineOffset: isToday ? "-2px" : undefined,
                overflow: "hidden",
              }}
            >
              {/* Hour grid lines */}
              {hourMarks.map((h) => {
                const top = (h - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
                return (
                  <div
                    key={`hour-${h}`}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top,
                      left: 0,
                      right: 0,
                      borderTop: "1px solid var(--border)",
                      pointerEvents: "none",
                    }}
                  />
                );
              })}
              {/* Half-hour dashed lines */}
              {halfHourMarks.map((h) => {
                const top = (h - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
                return (
                  <div
                    key={`half-${h}`}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top,
                      left: 0,
                      right: 0,
                      borderTop: "1px dashed var(--border)",
                      opacity: 0.6,
                      pointerEvents: "none",
                    }}
                  />
                );
              })}

              {/* Event chips */}
              {dayEvents.map((e) => {
                const top = chipTop(e);
                const height = chipHeight(e);
                return (
                  <EventChip key={e.id} event={e} top={top} height={height} />
                );
              })}

              {/* "Now" line — today only, only when current time is in working hours */}
              {isToday && showNowLine && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: nowLineTop,
                    left: 0,
                    right: 0,
                    height: 1.5,
                    backgroundColor: "var(--accent)",
                    pointerEvents: "none",
                    zIndex: 3,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function chipTop(event: CalendarEvent): number {
  const localHour = hourOfDayInTimezone(event.startsAt);
  const raw = (localHour - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
  return Math.max(0, Math.min(raw, WEEK_GRID_HEIGHT_PX - MIN_CHIP_HEIGHT));
}

function chipHeight(event: CalendarEvent): number {
  const durationMs = event.endsAt.getTime() - event.startsAt.getTime();
  // Default short-or-missing duration to one hour so chips remain legible.
  const hours = durationMs > 0 ? durationMs / (60 * 60 * 1000) : 1;
  const raw = hours * WEEK_GRID_HOUR_PX;
  return Math.max(MIN_CHIP_HEIGHT, raw);
}

const todayMarkerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 700,
  // Note: globals.css enforces `border-radius: 0 !important` on every
  // element. The mockup shows a circle; we render a square here so the
  // marker stays inside the design-system rule. Visually consistent with
  // the rest of the app.
};
