import type { CSSProperties } from "react";
import type { ShootRecord } from "@/lib/supabase";
import {
  dateKeyInMonth,
  dateKeyInTimezone,
  monthGridDateKeys,
} from "@/app/owner/calendar/_lib/timezone";
import { ClientShootPill } from "./ClientShootPill";

interface ClientBookingCalendarProps {
  /** YYYY-MM of the displayed month. */
  monthKey: string;
  /** Pre-filtered to the signed-in client + this month's grid range. */
  myShoots: ShootRecord[];
  /** URL prefix passed through to each pill (e.g. `/client/book?month=YYYY-MM`). */
  baseHref: string;
  /** Optional override for "now" — primarily for testing. */
  now?: Date;
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const CELL_MIN_HEIGHT = 96;

export function ClientBookingCalendar({
  monthKey,
  myShoots,
  baseHref,
  now = new Date(),
}: ClientBookingCalendarProps) {
  const grid = monthGridDateKeys(monthKey);
  const todayKey = dateKeyInTimezone(now);
  const hasAnyShoots = myShoots.length > 0;

  const shootsByDay = new Map<string, ShootRecord[]>();
  for (const s of myShoots) {
    const key = dateKeyInTimezone(new Date(s.scheduled_at));
    const list = shootsByDay.get(key);
    if (list) list.push(s);
    else shootsByDay.set(key, [s]);
  }
  // Defensive: the query orders by scheduled_at ascending, but sort each
  // day bucket again so any out-of-order rows still render chronologically.
  for (const list of shootsByDay.values()) {
    list.sort(
      (a, b) =>
        new Date(a.scheduled_at).getTime() -
        new Date(b.scheduled_at).getTime()
    );
  }

  return (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
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
          const dayShoots = shootsByDay.get(dk) ?? [];
          const col = idx % 7;
          const row = Math.floor(idx / 7);

          return (
            <div
              key={dk}
              style={{
                position: "relative",
                minHeight: CELL_MIN_HEIGHT,
                borderRight: col < 6 ? "1px solid var(--border)" : undefined,
                borderBottom: row < 5 ? "1px solid var(--border)" : undefined,
                backgroundColor: inMonth
                  ? "var(--surface-raised)"
                  : "var(--surface-base)",
                outline: isToday ? "2px solid var(--accent)" : undefined,
                outlineOffset: isToday ? "-2px" : undefined,
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  padding: "2px 4px",
                }}
              >
                {isToday ? (
                  <span style={todayMarkerStyle}>{dayNum}</span>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: inMonth
                        ? "var(--text-primary)"
                        : "var(--text-muted)",
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
                }}
              >
                {dayShoots.map((s) => (
                  <ClientShootPill key={s.id} shoot={s} baseHref={baseHref} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {!hasAnyShoots && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            color: "var(--text-muted)",
            fontSize: 14,
            fontStyle: "italic",
          }}
        >
          No shoots scheduled this month.
        </div>
      )}
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
};
