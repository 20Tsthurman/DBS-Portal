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
    borderLeft: v.borderLeft,
    backgroundColor: v.background,
    backgroundImage:
      v.fillTexture === "diagonal-stripes"
        ? stripeBackgroundImage(v.stripeColor)
        : undefined,
    color: v.textColor,
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
    <Link
      href={editHref}
      title={tooltip}
      className="h-4 leading-4 pl-1 pr-0.5 text-[10px] lg:h-[18px] lg:leading-[18px] lg:pl-1.5 lg:pr-1 lg:text-[11px]"
      style={pillStyle}
    >
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
