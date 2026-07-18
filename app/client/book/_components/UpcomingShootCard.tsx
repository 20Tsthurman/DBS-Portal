import Link from "next/link";
import type { CSSProperties } from "react";
import type { MeetingType, ShootRecord } from "@/lib/supabase";
import {
  formatTimeInTimezone,
  fullDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { StatusBadge } from "./StatusBadge";
import { IconCalendar, IconChevronRight } from "./Icons";
import { QuickMessageButton } from "@/components/messages/QuickMessageButton";

interface UpcomingShootCardProps {
  /** Already filtered to upcoming + sorted ascending by scheduled_at. */
  shoots: ShootRecord[];
  baseHref: string;
  clientId: string;
}

export function UpcomingShootCard({
  shoots,
  baseHref,
  clientId,
}: UpcomingShootCardProps) {
  const next = shoots[0] ?? null;
  const additional = Math.max(0, shoots.length - 1);
  const title =
    next && next.kind === "meeting" ? "Upcoming Meeting" : "Upcoming Shoot";

  return (
    <section style={cardStyle}>
      <header style={headerRowStyle}>
        <h3 style={titleStyle}>{title}</h3>
        {next && <StatusBadge status={next.status} />}
      </header>

      {next ? (
        <PopulatedBody
          shoot={next}
          additional={additional}
          baseHref={baseHref}
          clientId={clientId}
        />
      ) : (
        <EmptyBody />
      )}
    </section>
  );
}

function EmptyBody() {
  return (
    <div
      style={{
        padding: "32px 20px",
        textAlign: "center",
        color: "var(--text-muted)",
        fontStyle: "italic",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      Nothing on the calendar yet. Once you request a shoot and Kelsey
      confirms it, it&apos;ll show up here.
    </div>
  );
}

function meetingTypeFriendly(t: MeetingType): string {
  switch (t) {
    case "zoom":
      return "Zoom call";
    case "phone":
      return "Phone call";
    case "in_person":
      return "In-person";
  }
}

interface PopulatedBodyProps {
  shoot: ShootRecord;
  additional: number;
  baseHref: string;
  clientId: string;
}

function PopulatedBody({
  shoot,
  additional,
  baseHref,
  clientId,
}: PopulatedBodyProps) {
  const startsAt = new Date(shoot.scheduled_at);
  const endsAt = new Date(
    startsAt.getTime() + (shoot.duration_hours ?? 1) * 3600 * 1000
  );
  const dk = dateKeyInTimezone(startsAt);
  const dateLabel = fullDateLabelForDateKey(dk);
  const timeRange = `${formatTimeInTimezone(startsAt)} – ${formatTimeInTimezone(
    endsAt
  )}`;
  const location = shoot.location?.trim() || null;
  const isMeeting = shoot.kind === "meeting";
  const moreLabel =
    additional === 1
      ? "+ 1 more upcoming"
      : `+ ${additional} more upcoming`;
  // For Zoom and phone meetings, show the format label instead of (or in
  // addition to) a physical location.
  const formatLabel =
    isMeeting && shoot.meeting_type
      ? meetingTypeFriendly(shoot.meeting_type)
      : null;

  return (
    <>
      <div style={bodyRowStyle}>
        <div style={iconWrapStyle}>
          <IconCalendar size={24} color="var(--accent)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {dateLabel}
          </p>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              margin: 0,
              marginTop: 4,
            }}
          >
            {timeRange}
          </p>
          {formatLabel && (
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                margin: 0,
                marginTop: 2,
              }}
            >
              {formatLabel}
            </p>
          )}
          {location && (
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                margin: 0,
                marginTop: 2,
              }}
            >
              {location}
            </p>
          )}
        </div>
      </div>

      <div style={actionsStackStyle}>
        <Link
          href={`${baseHref}&shoot=${shoot.id}`}
          className="agenda-row"
          style={actionLinkStyle}
        >
          <span style={actionIconSlotStyle}>
            <IconCalendar size={18} color="var(--text-body)" />
          </span>
          <span style={{ flex: 1 }}>View Details</span>
          <IconChevronRight size={16} color="var(--text-muted)" />
        </Link>
        <QuickMessageButton clientId={clientId} viewerRole="client" />
      </div>

      {additional > 0 && <p style={moreLineStyle}>{moreLabel}</p>}
    </>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  padding: 20,
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  paddingBottom: 12,
  borderBottom: "1px solid var(--border)",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 16,
  fontWeight: 500,
  color: "var(--text-primary)",
  letterSpacing: "-0.01em",
  margin: 0,
};

const bodyRowStyle: CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "flex-start",
};

const iconWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 48,
  height: 48,
  backgroundColor: "rgba(168, 120, 138, 0.12)",
  flexShrink: 0,
};

const actionsStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const actionLinkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 500,
  textDecoration: "none",
};

const actionIconSlotStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const moreLineStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  fontStyle: "italic",
  margin: 0,
  textAlign: "center",
};
