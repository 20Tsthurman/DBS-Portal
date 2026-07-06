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

  // Google-imported events link out to Google Calendar instead of the
  // portal edit panel (read-only on our side).
  const external = event.source.kind === "external" ? event.source : null;
  const startLabel = external?.allDay
    ? "All day"
    : formatShortTimeInTimezone(event.startsAt);
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
  const tooltip = external
    ? `${startLabel} ${title} · View in Google Calendar`
    : pending
      ? `${startLabel} ${title} (pending)`
      : `${startLabel} ${title}`;

  const pillClassName =
    "h-4 leading-4 pl-1 pr-0.5 text-[10px] lg:h-[18px] lg:leading-[18px] lg:pl-1.5 lg:pr-1 lg:text-[11px]";

  const body = (
    <>
      <span style={{ opacity: 0.75, marginRight: 4 }}>{startLabel}</span>
      <span>{title}</span>
      {pending && (
        <span style={{ marginLeft: 4, fontStyle: "italic", opacity: 0.85 }}>
          (pending)
        </span>
      )}
    </>
  );

  if (external) {
    return (
      <a
        href={external.htmlLink ?? undefined}
        target="_blank"
        rel="noreferrer"
        title={tooltip}
        className={pillClassName}
        style={external.htmlLink ? pillStyle : { ...pillStyle, cursor: "default" }}
      >
        {body}
      </a>
    );
  }

  return (
    <Link
      href={editHref}
      title={tooltip}
      className={pillClassName}
      style={pillStyle}
    >
      {body}
    </Link>
  );
}
