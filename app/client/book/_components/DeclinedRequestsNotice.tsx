import Link from "next/link";
import type { CSSProperties } from "react";
import type { ShootRecord } from "@/lib/supabase";
import {
  formatTimeInTimezone,
  fullDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

interface DeclinedRequestsNoticeProps {
  /** Already filtered to the recent/upcoming window and sorted ascending. */
  shoots: ShootRecord[];
  /** URL of the request form, for the "pick another time" CTA. */
  requestHref: string;
  /** URL prefix to append `&shoot=<id>` to, for the detail panel link. */
  baseHref: string;
}

/**
 * The answer to a request Kelsey turned down.
 *
 * This notice exists because the calendar alone is too quiet for it. A
 * declined request renders as one struck-through pill on whatever day it was
 * asked for — easy to miss, and easy to misread as "my request never went
 * through". The client asked a question; the page should lead with the reply,
 * not bury it in a month grid.
 *
 * Deliberately not styled as an error. Kelsey being booked is ordinary, and
 * the only useful next step is picking another time — so the CTA is the
 * loudest thing here.
 */
export function DeclinedRequestsNotice({
  shoots,
  requestHref,
  baseHref,
}: DeclinedRequestsNoticeProps) {
  if (shoots.length === 0) return null;

  const many = shoots.length > 1;

  return (
    <section style={cardStyle} aria-label="Declined shoot requests">
      <header style={headerStyle}>
        <p style={eyebrowStyle}>
          {many ? `${shoots.length} requests declined` : "Request declined"}
        </p>
        <p style={sublineStyle}>
          {many
            ? "Kelsey wasn't able to take these times. Nothing is booked for them."
            : "Kelsey wasn't able to take this time. Nothing is booked for it."}
        </p>
      </header>

      <ul style={listStyle}>
        {shoots.map((shoot, i) => (
          <DeclinedRow
            key={shoot.id}
            shoot={shoot}
            isLast={i === shoots.length - 1}
            detailHref={`${baseHref}&shoot=${shoot.id}`}
          />
        ))}
      </ul>

      <footer style={footerStyle}>
        <Link href={requestHref} style={ctaStyle}>
          Pick another time
        </Link>
      </footer>
    </section>
  );
}

interface DeclinedRowProps {
  shoot: ShootRecord;
  isLast: boolean;
  detailHref: string;
}

function DeclinedRow({ shoot, isLast, detailHref }: DeclinedRowProps) {
  const startsAt = new Date(shoot.scheduled_at);
  const endsAt = new Date(
    startsAt.getTime() + (shoot.duration_hours ?? 1) * 3600 * 1000
  );
  const dateLabel = fullDateLabelForDateKey(dateKeyInTimezone(startsAt));
  const timeRange = `${formatTimeInTimezone(startsAt)} – ${formatTimeInTimezone(
    endsAt
  )}`;
  const note = shoot.decline_reason?.trim() || null;

  return (
    <li
      style={{
        ...rowStyle,
        borderBottom: isLast ? undefined : "1px solid var(--border)",
      }}
    >
      <Link href={detailHref} style={whenLinkStyle}>
        {dateLabel}
      </Link>
      <p style={timeLineStyle}>{timeRange}</p>
      {note ? (
        <blockquote style={noteStyle}>
          <span style={noteAttributionStyle}>Kelsey:</span> {note}
        </blockquote>
      ) : (
        <p style={noNoteStyle}>
          Kelsey didn&apos;t leave a note. Message her if you want to find a
          time together.
        </p>
      )}
    </li>
  );
}

const cardStyle: CSSProperties = {
  marginBottom: 24,
  border: "1px solid var(--border)",
  borderTop: "3px solid var(--status-danger)",
  backgroundColor: "var(--surface-raised)",
};

const headerStyle: CSSProperties = {
  padding: "14px 20px",
  borderBottom: "1px solid var(--border)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--status-danger)",
  fontWeight: 700,
  margin: 0,
};

const sublineStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-body)",
  margin: 0,
  marginTop: 4,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: "12px 20px",
};

const whenLinkStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "var(--text-primary)",
  // Struck, not underlined: the date is the thing that fell through.
  textDecoration: "line-through",
};

const timeLineStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  margin: 0,
};

const noteStyle: CSSProperties = {
  margin: 0,
  marginTop: 8,
  paddingLeft: 12,
  borderLeft: "2px solid var(--accent)",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-body)",
  whiteSpace: "pre-wrap",
};

const noteAttributionStyle: CSSProperties = {
  fontWeight: 600,
  color: "var(--text-primary)",
};

const noNoteStyle: CSSProperties = {
  margin: 0,
  marginTop: 8,
  fontSize: 13,
  fontStyle: "italic",
  color: "var(--text-muted)",
};

const footerStyle: CSSProperties = {
  padding: "14px 20px",
  borderTop: "1px solid var(--border)",
};

const ctaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "12px 22px",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  textDecoration: "none",
};
