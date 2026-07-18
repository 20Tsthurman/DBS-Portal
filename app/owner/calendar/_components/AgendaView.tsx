import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import { visualsForEvent } from "../_lib/eventColors";
import {
  addDaysToDateKey,
  formatTimeInTimezone,
  shortDateLabelForDateKey,
  shortWeekdayForDateKey,
} from "../_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

interface AgendaViewProps {
  /** YYYY-MM-DD — first day of the visible window. */
  startDateKey: string;
  /** Number of days forward to render. Default 14. */
  days?: number;
  events: CalendarEvent[];
  /** View-flavored base URL — used to build edit links. */
  baseHref: string;
  /** Optional override for "now". Defaults to `new Date()`. */
  now?: Date;
}

// Desktop column widths kept for parity at lg+. Mobile uses Tailwind
// classes that override these via the `lg:!w-[…]` important variant
// (inline `width:` would otherwise win over plain `w-*` classes).

export function AgendaView({
  startDateKey,
  days = 14,
  events,
  baseHref,
  now = new Date(),
}: AgendaViewProps) {
  const todayKey = dateKeyInTimezone(now);

  const dayKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    dayKeys.push(addDaysToDateKey(startDateKey, i));
  }

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = eventsByDay.get(e.dateKey);
    if (list) list.push(e);
    else eventsByDay.set(e.dateKey, [e]);
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
      {dayKeys.map((dk, i) => {
        const dayEvents = (eventsByDay.get(dk) ?? []).slice().sort(
          (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
        );
        const isToday = dk === todayKey;
        const dayNum = Number(dk.slice(8, 10));

        return (
          <div
            key={dk}
            style={{
              display: "flex",
              alignItems: "stretch",
              borderTop: i === 0 ? undefined : "1px solid var(--border)",
              minHeight: 80,
            }}
          >
            {/* Left date block */}
            <div
              className="w-16 px-2 py-3 lg:w-24 lg:px-3 lg:py-[14px]"
              style={{
                flexShrink: 0,
                borderRight: "1px solid var(--border)",
                backgroundColor: isToday
                  ? "rgba(168, 120, 138, 0.12)"
                  : "var(--surface-base)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 2,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: isToday ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {shortWeekdayForDateKey(dk)}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  fontFamily: "var(--font-playfair), serif",
                  color: "var(--text-primary)",
                  lineHeight: 1.1,
                }}
              >
                {dayNum}
              </div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                }}
              >
                {shortDateLabelForDateKey(dk).split(" ")[0]}
              </div>
            </div>

            {/* Right event list */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                padding: "8px 0",
              }}
            >
              {dayEvents.length === 0 ? (
                <p
                  style={{
                    padding: "10px 16px",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                    fontSize: 13,
                  }}
                >
                  Nothing scheduled.
                </p>
              ) : (
                dayEvents.map((e) => (
                  <AgendaRow key={e.id} event={e} baseHref={baseHref} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface AgendaRowProps {
  event: CalendarEvent;
  baseHref: string;
}

function AgendaRow({ event, baseHref }: AgendaRowProps) {
  const v = visualsForEvent(event);
  const editHref = `${baseHref}&date=${event.dateKey}&edit=${event.id}`;
  // Google-imported events link out to Google Calendar instead of the
  // portal edit panel (read-only on our side).
  const external = event.source.kind === "external" ? event.source : null;

  const startLabel = formatTimeInTimezone(event.startsAt);
  const endLabel = formatTimeInTimezone(event.endsAt);
  const showRange = event.endsAt.getTime() > event.startsAt.getTime();
  const timeText = external?.allDay
    ? "All day"
    : showRange
      ? `${startLabel} – ${endLabel}`
      : startLabel;

  const struck =
    v.textTexture === "strikethrough" ||
    event.status === "completed" ||
    event.status === "cancelled";
  const pending = event.status === "requested";

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    padding: "8px 16px 8px 0",
    color: "var(--text-primary)",
    textDecoration: "none",
    borderLeft: v.borderLeft,
    marginLeft: 0,
    transition: "background-color 0.12s",
  };

  const body = (
    <>
      <div
        className="w-[100px] px-2.5 lg:w-[140px] lg:px-[14px]"
        style={{
          flexShrink: 0,
          fontSize: 12,
          color: "var(--text-body)",
          fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          display: "flex",
          alignItems: "center",
        }}
      >
        {timeText}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
            textDecoration: struck ? "line-through" : undefined,
            fontStyle: v.textTexture === "italic" ? "italic" : undefined,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {event.title || "—"}
          {pending && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                fontStyle: "italic",
                color: "var(--text-muted)",
                fontWeight: 500,
              }}
            >
              (pending)
            </span>
          )}
        </div>
        {event.subtitle && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.subtitle}
          </div>
        )}
      </div>
    </>
  );

  if (external) {
    return (
      <a
        href={external.htmlLink ?? undefined}
        target="_blank"
        rel="noreferrer"
        title="View in Google Calendar"
        style={external.htmlLink ? rowStyle : { ...rowStyle, cursor: "default" }}
        className="agenda-row"
      >
        {body}
      </a>
    );
  }

  return (
    <Link href={editHref} style={rowStyle} className="agenda-row">
      {body}
    </Link>
  );
}
