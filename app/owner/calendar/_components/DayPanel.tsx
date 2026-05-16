import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import { stripeBackgroundImage, visualsForEvent } from "../_lib/eventColors";
import { formatTimeInTimezone } from "../_lib/timezone";

interface DayPanelProps {
  /**
   * View-flavored base URL (e.g. `/owner/calendar?view=week&week=YYYY-MM-DD`
   * or `/owner/calendar?view=month&month=YYYY-MM`). The panel appends
   * `&date=…`, `&new=…`, `&edit=…` as needed. This keeps the panel
   * view-agnostic so Week and Month share it.
   */
  baseHref: string;
  /** Selected day's YYYY-MM-DD in PORTAL_TIMEZONE. */
  dateKey: string;
  /** Events for the selected day. Already filtered upstream. */
  events: CalendarEvent[];
}

const PANEL_WIDTH = 320;

export function DayPanel({ baseHref, dateKey, events }: DayPanelProps) {
  const closeHref = baseHref;
  const sortedEvents = [...events].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );
  const addSessionHref = `${baseHref}&date=${dateKey}&new=shoot`;
  const addTimeBlockHref = `${baseHref}&date=${dateKey}&new=time_block&block_category=blocked`;

  return (
    <>
      {/* Backdrop — clicking it closes the panel by navigating to the bare week URL. */}
      <Link
        href={closeHref}
        aria-label="Close day panel"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.2)",
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label={`Events on ${formatLongDate(dateKey)}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          maxWidth: "100%",
          backgroundColor: "var(--surface-raised)",
          borderLeft: "1px solid var(--border)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            gap: 12,
          }}
        >
          <div>
            <p className="eyebrow" style={{ marginBottom: 2 }}>
              {formatWeekdayLong(dateKey)}
            </p>
            <h2
              style={{
                fontFamily: "var(--font-playfair), serif",
                fontSize: 18,
                fontWeight: 500,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              {formatMonthDay(dateKey)}
            </h2>
          </div>
          <Link
            href={closeHref}
            aria-label="Close"
            style={iconCloseStyle}
          >
            ×
          </Link>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {sortedEvents.length === 0 ? (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                fontStyle: "italic",
              }}
            >
              No events scheduled.
            </p>
          ) : (
            sortedEvents.map((e) => (
              <EventCard key={e.id} event={e} baseHref={baseHref} />
            ))
          )}
        </div>

        <footer
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "16px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Link href={addSessionHref} style={primaryActionStyle}>
            + Add session
          </Link>
          <Link href={addTimeBlockHref} style={secondaryActionStyle}>
            + Add time block
          </Link>
        </footer>
      </aside>
    </>
  );
}

interface EventCardProps {
  event: CalendarEvent;
  baseHref: string;
}

function EventCard({ event, baseHref }: EventCardProps) {
  const v = visualsForEvent(event);
  const editHref = `${baseHref}&date=${event.dateKey}&edit=${event.id}`;

  const cardStyle: CSSProperties = {
    display: "block",
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderLeft: v.borderLeft,
    backgroundColor: v.background,
    backgroundImage:
      v.fillTexture === "diagonal-stripes"
        ? stripeBackgroundImage(v.stripeColor)
        : undefined,
    color: v.textColor,
    cursor: "pointer",
    textDecoration: "none",
  };

  const startLabel = formatTimeInTimezone(event.startsAt);
  const endLabel = formatTimeInTimezone(event.endsAt);
  const showRange = event.endsAt.getTime() > event.startsAt.getTime();
  const timeText = showRange ? `${startLabel} – ${endLabel}` : startLabel;

  const titleStyle: CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    textDecoration:
      v.textTexture === "strikethrough" ? "line-through" : undefined,
    fontStyle: v.textTexture === "italic" ? "italic" : undefined,
  };

  return (
    <Link href={editHref} style={cardStyle}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {categoryBadge(event)}
      </div>
      <div style={titleStyle}>{event.title || "—"}</div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-body)",
          marginTop: 2,
        }}
      >
        {timeText}
      </div>
      {event.subtitle && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            marginTop: 2,
          }}
        >
          {event.subtitle}
        </div>
      )}
    </Link>
  );
}

function categoryBadge(event: CalendarEvent): string {
  switch (event.category) {
    case "shoot":
      return `Shoot · ${capitalize(event.status)}`;
    case "meeting":
      return `Meeting · ${capitalize(event.status)}`;
    case "sonography":
      return "Sonography";
    case "work_block":
      return "Work block";
    case "blocked":
      return "Blocked";
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatMonthDay(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${d}, ${y}`;
}

function formatWeekdayLong(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // UTC-based day-of-week — calendrically consistent across zones.
  return WEEKDAY_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function formatLongDate(dateKey: string): string {
  return `${formatWeekdayLong(dateKey)}, ${formatMonthDay(dateKey)}`;
}

const iconCloseStyle: CSSProperties = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-body)",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  fontSize: 18,
  lineHeight: 1,
  textDecoration: "none",
};

const primaryActionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "10px 16px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
  textDecoration: "none",
};

const secondaryActionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "10px 16px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "transparent",
  color: "var(--text-body)",
  border: "1px solid var(--border)",
  textDecoration: "none",
};
