import Link from "next/link";
import type {
  AvailabilityBlockRecord,
  ClientRecord,
} from "@/lib/supabase";
import type { ShootWithClientName } from "@/app/owner/shoots/_lib/queries";
import {
  dateKey,
  formatWeekParam,
  getWeekDates,
  hourLabel,
  isToday,
  WEEK_GRID_END_HOUR,
  WEEK_GRID_HEIGHT_PX,
  WEEK_GRID_HOUR_PX,
  WEEK_GRID_START_HOUR,
  weekGridTopForClock,
  weekGridTopForDate,
} from "../_lib/dateMath";
import {
  classifyBlocksForDate,
  inverseAvailabilityWindows,
} from "../_lib/queries";
import { WeekGridShoot } from "./WeekGridShoot";

interface WeekGridProps {
  weekStart: Date;
  shoots: ShootWithClientName[];
  blocks: AvailabilityBlockRecord[];
  clients: Pick<ClientRecord, "id" | "name">[];
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const TIME_COL_PX = 60;
const ALL_DAY_ROW_PX = 24;
const HEADER_ROW_PX = 56;
const MIN_SHOOT_HEIGHT = 32;

function shootHeight(durationHours: number | null): number {
  const hours = durationHours ?? 1;
  return Math.max(hours * WEEK_GRID_HOUR_PX, MIN_SHOOT_HEIGHT);
}

function blockHeight(start: string, end: string): number {
  const top = weekGridTopForClock(start);
  const bottom = weekGridTopForClock(end);
  return Math.max(bottom - top, 16);
}

// "Context" pattern — diagonal stripes over a mauve tint to clearly differentiate
// availability blocks from shoot events.
const BLOCK_TINT = "rgba(168, 120, 138, 0.12)";
const BLOCK_STRIPES =
  "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(168, 120, 138, 0.15) 4px, rgba(168, 120, 138, 0.15) 8px)";

export function WeekGrid({ weekStart, shoots, blocks, clients }: WeekGridProps) {
  const days = getWeekDates(weekStart);
  const weekParam = formatWeekParam(weekStart);

  const shootsByDay = new Map<string, ShootWithClientName[]>();
  for (const s of shoots) {
    const k = dateKey(new Date(s.scheduled_at));
    const list = shootsByDay.get(k);
    if (list) list.push(s);
    else shootsByDay.set(k, [s]);
  }

  const classifyByDay = days.map((d) => classifyBlocksForDate(blocks, d));
  const anyAllDay = classifyByDay.some((c) =>
    c.blockedBlocks.some((b) => b.start_time === null)
  );

  const hourMarks: number[] = [];
  for (let h = WEEK_GRID_START_HOUR; h <= WEEK_GRID_END_HOUR; h++) {
    hourMarks.push(h);
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
        {days.map((day, i) => {
          const today = isToday(day);
          return (
            <div
              key={dateKey(day)}
              style={{
                position: "relative",
                padding: "10px 12px",
                borderRight:
                  i < 6 ? "1px solid var(--border)" : undefined,
                backgroundColor: "var(--surface-base)",
                outline: today ? "2px solid var(--accent)" : undefined,
                outlineOffset: today ? "-2px" : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  marginBottom: 2,
                }}
              >
                {WEEKDAY_LABELS[i]}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {day.getDate()}
                {today && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 4,
                      height: 4,
                      backgroundColor: "var(--accent)",
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day strip — only rendered if any day has all-day blocks */}
      {anyAllDay && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              borderRight: "1px solid var(--border)",
              padding: "6px 8px",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 600,
            }}
          >
            All-day
          </div>
          {days.map((day, i) => {
            const allDay = classifyByDay[i].blockedBlocks.filter(
              (b) => b.start_time === null
            );
            return (
              <div
                key={dateKey(day) + "-allday"}
                style={{
                  borderRight:
                    i < 6 ? "1px solid var(--border)" : undefined,
                  padding: 2,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {allDay.map((b) => (
                  <Link
                    key={b.id}
                    href={`/owner/calendar?view=week&week=${weekParam}&date=${dateKey(day)}`}
                    title={b.label ?? "Unavailable"}
                    style={{
                      display: "block",
                      height: ALL_DAY_ROW_PX,
                      lineHeight: `${ALL_DAY_ROW_PX}px`,
                      padding: "0 8px",
                      fontSize: 10,
                      fontStyle: "italic",
                      color: "var(--text-muted)",
                      backgroundColor: BLOCK_TINT,
                      backgroundImage: BLOCK_STRIPES,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {b.label ?? "Unavailable"}
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}

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
            const top = (h - WEEK_GRID_START_HOUR) * WEEK_GRID_HOUR_PX;
            // Skip the final mark to avoid label outside the area.
            if (h === WEEK_GRID_END_HOUR) return null;
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
        {days.map((day, i) => {
          const dayKey = dateKey(day);
          const dayShoots = shootsByDay.get(dayKey) ?? [];
          const { mode, blockedBlocks, availableBlocks } = classifyByDay[i];
          const timeRangeBlocked = blockedBlocks.filter(
            (b) => b.start_time !== null && b.end_time !== null
          );

          // Available mode: if any all-day available block applies, the whole
          // day is open and no inverse striping renders. Otherwise carve the
          // inverse of the time-range available windows.
          const hasAllDayAvailable = availableBlocks.some(
            (b) => b.start_time === null
          );
          const timeRangeAvailable = availableBlocks.filter(
            (b) => b.start_time !== null && b.end_time !== null
          );
          const inverseRegions =
            mode === "available" &&
            !hasAllDayAvailable &&
            timeRangeAvailable.length > 0
              ? inverseAvailabilityWindows(
                  timeRangeAvailable.map((b) => ({
                    start_time: b.start_time as string,
                    end_time: b.end_time as string,
                  })),
                  WEEK_GRID_START_HOUR,
                  WEEK_GRID_END_HOUR
                )
              : [];

          const dayHref = `/owner/calendar?view=week&week=${weekParam}&date=${dayKey}`;

          return (
            <div
              key={dayKey}
              style={{
                position: "relative",
                height: WEEK_GRID_HEIGHT_PX,
                borderRight: i < 6 ? "1px solid var(--border)" : undefined,
                backgroundColor: "var(--surface-base)",
                overflow: "hidden",
              }}
            >
              {/* Empty-area click target (lowest layer) */}
              <Link
                href={dayHref}
                aria-label={`Open ${dayKey}`}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 0,
                }}
              />

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

              {/* Implicit inverse-stripe regions in available mode (no labels, no clicks) */}
              {inverseRegions.map((r) => (
                <div
                  key={`inv-${r.start_time}-${r.end_time}`}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: weekGridTopForClock(r.start_time),
                    left: 2,
                    right: 2,
                    height: blockHeight(r.start_time, r.end_time),
                    backgroundColor: BLOCK_TINT,
                    backgroundImage: BLOCK_STRIPES,
                    pointerEvents: "none",
                    zIndex: 1,
                  }}
                />
              ))}

              {/* Explicit time-range blocked blocks */}
              {timeRangeBlocked.map((b) => {
                const top = weekGridTopForClock(b.start_time!);
                const height = blockHeight(b.start_time!, b.end_time!);
                return (
                  <Link
                    key={b.id}
                    href={dayHref}
                    title={b.label ?? "Unavailable"}
                    style={{
                      position: "absolute",
                      top,
                      left: 2,
                      right: 2,
                      height,
                      backgroundColor: BLOCK_TINT,
                      backgroundImage: BLOCK_STRIPES,
                      padding: "2px 6px",
                      fontSize: 10,
                      fontStyle: "italic",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      zIndex: 1,
                    }}
                  >
                    {b.label ?? "Unavailable"}
                  </Link>
                );
              })}

              {/* Shoot blocks */}
              {dayShoots.map((s) => {
                const top = weekGridTopForDate(new Date(s.scheduled_at));
                const height = shootHeight(
                  s.duration_hours !== null ? Number(s.duration_hours) : null
                );
                return (
                  <WeekGridShoot
                    key={s.id}
                    shoot={s}
                    clients={clients}
                    top={top}
                    height={height}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
