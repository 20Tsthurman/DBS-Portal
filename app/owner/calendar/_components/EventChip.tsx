"use client";

import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import { stripeBackgroundImage, visualsForEvent } from "../_lib/eventColors";
import { formatTimeInTimezone } from "../_lib/timezone";

interface EventChipProps {
  event: CalendarEvent;
  top: number;
  height: number;
}

export function EventChip({ event, top, height }: EventChipProps) {
  const v = visualsForEvent(event);

  const baseStyle: CSSProperties = {
    position: "absolute",
    top,
    left: 2,
    right: 2,
    height,
    border: "none",
    borderLeft: v.borderLeft,
    backgroundColor: v.background,
    backgroundImage:
      v.fillTexture === "diagonal-stripes"
        ? stripeBackgroundImage()
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
    <button
      type="button"
      title={tooltip}
      style={baseStyle}
      onClick={(e) => {
        e.stopPropagation();
        // Placeholder — day panel wiring lands in the next PR.
        // eslint-disable-next-line no-console
        console.log("[calendar] event clicked", event.id);
      }}
    >
      <div style={timeStyle}>{timeText}</div>
      <div style={titleStyle}>{event.title || "—"}</div>
      {event.subtitle && <div style={subtitleStyle}>{event.subtitle}</div>}
    </button>
  );
}
