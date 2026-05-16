import Link from "next/link";
import type { CSSProperties } from "react";
import type { CalendarEvent } from "../_lib/types";
import { stripeBackgroundImage, visualsForEvent } from "../_lib/eventColors";
import { formatShortTimeInTimezone } from "../_lib/timezone";

interface MonthEventPillProps {
  event: CalendarEvent;
  /** YYYY-MM of the displayed month — preserved in the edit URL so the panel closes back here. */
  monthKey: string;
}

const PILL_HEIGHT = 18;

export function MonthEventPill({ event, monthKey }: MonthEventPillProps) {
  const v = visualsForEvent(event);
  const editHref = `/owner/calendar?view=month&month=${monthKey}&date=${event.dateKey}&edit=${event.id}`;

  const startLabel = formatShortTimeInTimezone(event.startsAt);
  const pending = event.status === "requested";
  const struck =
    v.textTexture === "strikethrough" ||
    event.status === "completed" ||
    event.status === "cancelled";

  const pillStyle: CSSProperties = {
    position: "relative",
    display: "block",
    height: PILL_HEIGHT,
    lineHeight: `${PILL_HEIGHT}px`,
    paddingLeft: 6,
    paddingRight: 4,
    borderLeft: v.borderLeft,
    backgroundColor: v.background,
    backgroundImage:
      v.fillTexture === "diagonal-stripes" ? stripeBackgroundImage() : undefined,
    color: v.textColor,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textDecoration: struck ? "line-through" : "none",
    fontStyle: v.textTexture === "italic" ? "italic" : undefined,
    cursor: "pointer",
    zIndex: 2,
  };

  const title = event.title || "—";
  const tooltip = pending ? `${startLabel} ${title} (pending)` : `${startLabel} ${title}`;

  return (
    <Link href={editHref} title={tooltip} style={pillStyle}>
      <span style={{ opacity: 0.75, marginRight: 4 }}>{startLabel}</span>
      <span>{title}</span>
      {pending && (
        <span style={{ marginLeft: 4, fontStyle: "italic", opacity: 0.85 }}>
          (pending)
        </span>
      )}
    </Link>
  );
}
