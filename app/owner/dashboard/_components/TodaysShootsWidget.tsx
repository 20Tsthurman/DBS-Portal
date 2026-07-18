import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  formatTimeInTimezone,
  PORTAL_TIMEZONE,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { fetchShootsForDay } from "@/app/owner/shoots/_lib/queries";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { shootTone } from "./shootTone";

/**
 * Server-rendered "today" panel. Pulls shoots whose Central-time day equals
 * the current Central day, status in (requested, confirmed), ascending.
 */
export async function TodaysShootsWidget() {
  const now = new Date();
  const todayKey = dateKeyInTimezone(now);
  const shoots = await fetchShootsForDay(now);

  return (
    <DashboardCard eyebrow="TODAY" title={titleForKey(todayKey)}>
      {shoots.length === 0 ? (
        <div
          style={{
            paddingTop: 24,
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          No shoots scheduled today.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {shoots.map((shoot, idx) => {
            const startsAt = new Date(shoot.scheduled_at);
            const timeLabel = formatTimeInTimezone(startsAt);
            const durationLabel =
              shoot.duration_hours !== null
                ? formatDurationLabel(Number(shoot.duration_hours))
                : null;
            const clientName = shoot.client_name || "Unknown client";
            const tone = shootTone(shoot.status);
            const statusLabel =
              shoot.status.charAt(0).toUpperCase() + shoot.status.slice(1);

            return (
              <li
                key={shoot.id}
                style={{
                  borderTop: idx === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <Link
                  // No /owner/shoots/[id] detail page exists yet — actions live
                  // in the row dropdown on the shoots list. Send users there.
                  href="/owner/shoots"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "14px 0",
                    color: "inherit",
                  }}
                >
                  <div style={{ width: 100, flexShrink: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-playfair), serif",
                        fontSize: 18,
                        color: "var(--text-primary)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {timeLabel}
                    </div>
                    {durationLabel && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          marginTop: 2,
                        }}
                      >
                        {durationLabel}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {clientName}
                    </div>
                    {shoot.location && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "var(--text-body)",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {shoot.location}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <StatusPill tone={tone}>{statusLabel}</StatusPill>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}

/** "Saturday, May 16" — short form (no year) for the widget header. */
function titleForKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Anchor at noon UTC to avoid TZ edge cases when Intl reads the date.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(anchor);
}

function formatDurationLabel(hours: number): string {
  // Match existing convention: "2 hr" / "1.5 hr" — single unit, no plural.
  const formatted = Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted} hr`;
}
