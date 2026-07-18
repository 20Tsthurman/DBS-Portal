import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  formatTimeInTimezone,
  PORTAL_TIMEZONE,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { fetchShootsForWeekAhead } from "@/app/owner/shoots/_lib/queries";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { shootTone } from "./shootTone";

/**
 * Server-rendered "next 7 days" strip. Excludes today (Widget 1 handles it).
 * Cards are 220px wide, flex-wrap so they pile on narrow viewports.
 */
export async function UpcomingWeekWidget() {
  const shoots = await fetchShootsForWeekAhead();

  return (
    <DashboardCard eyebrow="NEXT 7 DAYS" title="Upcoming Shoots">
      {shoots.length === 0 ? (
        <p
          style={{
            paddingTop: 8,
            color: "var(--text-muted)",
            fontSize: 14,
            margin: 0,
          }}
        >
          Nothing scheduled this week.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {shoots.map((shoot) => {
            const startsAt = new Date(shoot.scheduled_at);
            const dateKey = dateKeyInTimezone(startsAt);
            return (
              <Link
                key={shoot.id}
                // No /owner/shoots/[id] detail page exists yet — actions live
                // in the row dropdown on the shoots list. Send users there.
                href="/owner/shoots"
                className="border"
                style={{
                  flex: "0 0 220px",
                  borderColor: "var(--border)",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  position: "relative",
                  color: "inherit",
                  backgroundColor: "var(--surface-base)",
                }}
              >
                {shoot.status === "requested" && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                    }}
                  >
                    <StatusPill tone={shootTone(shoot.status)}>
                      Requested
                    </StatusPill>
                  </div>
                )}
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      letterSpacing: "0.06em",
                      fontWeight: 600,
                    }}
                  >
                    {shortWeekday(dateKey)}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-playfair), serif",
                      fontSize: 18,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.01em",
                      marginTop: 2,
                    }}
                  >
                    {shortDate(dateKey)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--text-body)",
                  }}
                >
                  {formatTimeInTimezone(startsAt)}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shoot.client_name || "Unknown client"}
                  </div>
                  {shoot.location && (
                    <div
                      style={{
                        fontSize: 12,
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
              </Link>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

function shortWeekday(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_TIMEZONE,
    weekday: "short",
  }).format(anchor);
}

function shortDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_TIMEZONE,
    month: "short",
    day: "numeric",
  }).format(anchor);
}
