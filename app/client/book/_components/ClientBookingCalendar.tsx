import type { CSSProperties } from "react";
import type { ShootRecord } from "@/lib/supabase";
import {
  dateKeyInMonth,
  monthGridDateKeys,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
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

      <div className="grid grid-cols-7 auto-rows-[minmax(64px,auto)] lg:auto-rows-[minmax(96px,auto)]">
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
              className="p-0.5 lg:p-1"
              style={{
                position: "relative",
                borderRight: col < 6 ? "1px solid var(--border)" : undefined,
                borderBottom: row < 5 ? "1px solid var(--border)" : undefined,
                backgroundColor: inMonth
                  ? "var(--surface-raised)"
                  : "var(--surface-base)",
                outline: isToday ? "2px solid var(--accent)" : undefined,
                outlineOffset: isToday ? "-2px" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "hidden",
              }}
            >
              <div
                className="px-1 py-0.5"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
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
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontWeight: 700,
};
