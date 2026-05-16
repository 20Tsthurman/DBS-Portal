import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import { stripeBackgroundImage, visualsForEvent } from "../_lib/eventColors";
import { formatTimeInTimezone } from "../_lib/timezone";

interface EventChipProps {
  event: CalendarEvent;
  weekKey: string;
  top: number;
  height: number;
  laneIndex: number;
  laneCount: number;
}

export function EventChip({
  event,
  weekKey,
  top,
  height,
  laneIndex,
  laneCount,
}: EventChipProps) {
  const v = visualsForEvent(event);
  const editHref = `/owner/calendar?view=week&week=${weekKey}&date=${event.dateKey}&edit=${event.id}`;

  const widthPct = 100 / laneCount;
  const leftPct = laneIndex * widthPct;

  const baseStyle: CSSProperties = {
    position: "absolute",
    top,
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
    height,
    display: "block",
    borderLeft: v.borderLeft,
    backgroundColor: v.background,
    backgroundImage:
      v.fillTexture === "diagonal-stripes"
        ? stripeBackgroundImage(v.stripeColor)
        : undefined,
    color: v.textColor,
    padding: "4px 8px",
    fontSize: 11,
    lineHeight: 1.3,
    textAlign: "left",
    cursor: "pointer",
    overflow: "hidden",
    fontFamily: "inherit",
    fontStyle: v.textTexture === "italic" ? "italic" : undefined,
    textDecoration: "none",
    zIndex: 2,
  };

  const titleStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textDecoration:
      v.textTexture === "strikethrough" ? "line-through" : undefined,
  };

  const subtitleStyle: CSSProperties = {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginTop: 1,
  };

  const timeStyle: CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    opacity: 0.8,
    marginBottom: 1,
  };

  const startLabel = formatTimeInTimezone(event.startsAt);
  const endLabel = formatTimeInTimezone(event.endsAt);
  const showRange = event.endsAt.getTime() > event.startsAt.getTime();
  const timeText = showRange ? `${startLabel} – ${endLabel}` : startLabel;

  const tooltip = [
    timeText,
    event.title,
    event.subtitle,
    event.status === "requested" ? "(Pending)" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link href={editHref} title={tooltip} style={baseStyle}>
      <div style={timeStyle}>{timeText}</div>
      <div style={titleStyle}>{event.title || "—"}</div>
      {event.subtitle && <div style={subtitleStyle}>{event.subtitle}</div>}
    </Link>
  );
}
