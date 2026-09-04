import Link from "next/link";
import type { CSSProperties } from "react";
import type { ShootRecord } from "@/lib/supabase";
import type { CalendarEvent } from "@/app/owner/calendar/_lib/types";
import {
  stripeBackgroundImage,
  visualsForEvent,
} from "@/app/owner/calendar/_lib/eventColors";
import {
  formatShortTimeInTimezone,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

interface ClientShootPillProps {
  shoot: ShootRecord;
  /** URL prefix to append `&shoot=<id>` to (e.g. `/client/book?month=YYYY-MM`). */
  baseHref: string;
}

const PILL_HEIGHT = 18;

export function ClientShootPill({ shoot, baseHref }: ClientShootPillProps) {
  const startsAt = new Date(shoot.scheduled_at);
  const endsAt = new Date(
    startsAt.getTime() + (shoot.duration_hours ?? 1) * 3600 * 1000
  );
  const isMeeting = shoot.kind === "meeting";
  const pillLabel = isMeeting ? "Your meeting" : "Your shoot";
  const event: CalendarEvent = {
    id: `shoot:${shoot.id}`,
    category: isMeeting ? "meeting" : "shoot",
    dateKey: dateKeyInTimezone(startsAt),
    startsAt,
    endsAt,
    title: pillLabel,
    subtitle: null,
    status: shoot.status,
    source: { kind: "shoot", shootId: shoot.id, clientId: shoot.client_id },
  };

  const v = visualsForEvent(event);
  const startLabel = formatShortTimeInTimezone(startsAt);
  const pending = shoot.status === "requested";
  const declined = shoot.status === "declined";
  const struck =
    v.textTexture === "strikethrough" ||
    shoot.status === "completed" ||
    shoot.status === "cancelled" ||
    declined;

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
      v.fillTexture === "diagonal-stripes"
        ? stripeBackgroundImage(v.stripeColor)
        : undefined,
    color: v.textColor,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textDecoration: struck ? "line-through" : "none",
    fontStyle: v.textTexture === "italic" ? "italic" : undefined,
    zIndex: 2,
  };

  return (
    <Link
      href={`${baseHref}&shoot=${shoot.id}`}
      className="client-shoot-pill"
      style={pillStyle}
    >
      <span style={{ opacity: 0.75, marginRight: 4 }}>{startLabel}</span>
      <span>{pillLabel}</span>
      {pending && (
        <span style={{ marginLeft: 4, fontStyle: "italic", opacity: 0.85 }}>
          (pending)
        </span>
      )}
      {/* A declined request stays on the grid, struck through and labelled.
          Hiding it is what made a decline look like a request that never
          sent — the whole point of migration 020. */}
      {declined && (
        <span style={{ marginLeft: 4, fontStyle: "italic", opacity: 0.85 }}>
          (declined)
        </span>
      )}
    </Link>
  );
}
