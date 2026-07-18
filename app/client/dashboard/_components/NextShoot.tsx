import type { CSSProperties } from "react";
import type { ShootRecord } from "@/lib/supabase";
import {
  formatTimeInTimezone,
  fullDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

interface NextShootProps {
  /** Soonest upcoming session, or null when nothing is scheduled. */
  shoot: ShootRecord | null;
}

export function NextShoot({ shoot }: NextShootProps) {
  if (!shoot) {
    return <div style={emptyStateStyle}>No upcoming shoots scheduled.</div>;
  }

  // scheduled_at is a full UTC timestamp; render the wall clock in the
  // portal timezone rather than the server's local zone.
  const startsAt = new Date(shoot.scheduled_at);
  const dateLabel = fullDateLabelForDateKey(dateKeyInTimezone(startsAt));
  const timeLabel = formatTimeInTimezone(startsAt);
  const location = shoot.location?.trim() || null;
  const kindLabel = shoot.kind === "meeting" ? "Meeting" : "Shoot";

  return (
    <div style={cardStyle}>
      <p style={dateStyle}>{dateLabel}</p>
      <p style={detailStyle}>
        {timeLabel}
        {location ? ` · ${location}` : ""}
      </p>
      <p style={kindStyle}>{kindLabel}</p>
    </div>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "20px 24px",
};

const dateStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: "var(--text-primary)",
  lineHeight: 1.3,
};

const detailStyle: CSSProperties = {
  margin: "6px 0 0",
  fontSize: 14,
  color: "var(--text-body)",
};

const kindStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
};

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 14,
};
