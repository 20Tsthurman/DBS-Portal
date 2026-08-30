import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import { MonthGrid } from "./MonthGrid";
import { MonthEventPill } from "./MonthEventPill";

interface MonthViewProps {
  /** YYYY-MM of the displayed month. */
  monthKey: string;
  events: CalendarEvent[];
  /** Optional override for "now" — primarily for testing. Defaults to `new Date()`. */
  now?: Date;
}

const MAX_VISIBLE_PILLS = 3;

/**
 * The owner calendar's month view: `MonthGrid` layout plus the owner-specific
 * pieces the grid no longer hard-codes — the DayPanel deep-link on every day
 * cell and "+N more" overflow link, and `MonthEventPill` for shoot /
 * time-block / Google-event pills. Public props are unchanged from before the
 * Phase 3 extraction, and the rendered output must stay identical: this is
 * the live calendar.
 */
export function MonthView({ monthKey, events, now }: MonthViewProps) {
  return (
    <MonthGrid
      monthKey={monthKey}
      events={events}
      now={now}
      dayHref={(dk) => `/owner/calendar?view=month&month=${monthKey}&date=${dk}`}
      renderDayContent={(dayEvents, day) => {
        const visible = dayEvents.slice(0, MAX_VISIBLE_PILLS);
        const overflow = dayEvents.length - visible.length;
        return (
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
              <Link href={day.href} style={overflowLinkStyle}>
                +{overflow} more
              </Link>
            )}
          </div>
        );
      }}
    />
  );
}

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
