import {
  dateKeyInTimezone,
  fullDateLabelForDateKey,
  PORTAL_TIMEZONE,
} from "@/app/owner/calendar/_lib/timezone";
import { fetchUnreadCountsForOwner } from "@/app/owner/messages/_lib/queries";
import { TodaysShootsWidget } from "./_components/TodaysShootsWidget";
import { UnreadMessagesWidget } from "./_components/UnreadMessagesWidget";
import { UpcomingWeekWidget } from "./_components/UpcomingWeekWidget";
import { HoursThisWeekWidget } from "./_components/HoursThisWeekWidget";
import { BudgetStatusWidget } from "./_components/BudgetStatusWidget";
import { ClientRosterWidget } from "./_components/ClientRosterWidget";
import { TasksDueWidget } from "./_components/TasksDueWidget";

export const dynamic = "force-dynamic";

export default async function OwnerDashboardPage() {
  const now = new Date();
  const greeting = greetingForCentralHour(now);
  const dateLabel = fullDateLabelForDateKey(dateKeyInTimezone(now));

  // Initial SSR payload for the polled widget. Fetch in parallel with the
  // server-component widgets via React's Suspense-friendly render path.
  const initialUnread = await fetchUnreadCountsForOwner();

  return (
    <section>
      <header style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: 32,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          {greeting}, Kelsey
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            marginTop: 6,
          }}
        >
          {dateLabel}
        </p>
      </header>

      <div className="dashboard-grid">
        <div className="dashboard-cell dashboard-cell-today">
          <TodaysShootsWidget />
        </div>
        <div className="dashboard-cell dashboard-cell-unread">
          <UnreadMessagesWidget initial={initialUnread} />
        </div>
        <div className="dashboard-cell dashboard-cell-week">
          <UpcomingWeekWidget />
        </div>
        <div className="dashboard-cell dashboard-cell-tasks">
          <TasksDueWidget />
        </div>
        <div className="dashboard-cell dashboard-cell-hours">
          <HoursThisWeekWidget />
        </div>
        <div className="dashboard-cell dashboard-cell-budget">
          <BudgetStatusWidget />
        </div>
        <div className="dashboard-cell dashboard-cell-roster">
          <ClientRosterWidget />
        </div>
      </div>

      <style>{`
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(12, minmax(0, 1fr));
          gap: 24px;
        }
        .dashboard-cell-today { grid-column: span 8; }
        .dashboard-cell-unread { grid-column: span 4; }
        .dashboard-cell-week { grid-column: span 8; }
        .dashboard-cell-tasks { grid-column: span 4; }
        .dashboard-cell-hours { grid-column: span 4; }
        .dashboard-cell-budget { grid-column: span 8; }
        .dashboard-cell-roster { grid-column: span 12; }

        @media (max-width: 1023px) {
          .dashboard-grid {
            grid-template-columns: 1fr;
          }
          .dashboard-cell {
            grid-column: 1 / -1;
          }
        }
      `}</style>
    </section>
  );
}

/**
 * Greeting based on the wall-clock hour in PORTAL_TIMEZONE.
 *   < 12 → morning
 *   12–17 → afternoon
 *   18+ → evening
 */
function greetingForCentralHour(now: Date): string {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: PORTAL_TIMEZONE,
    hourCycle: "h23",
    hour: "2-digit",
  }).format(now);
  const hour = Number(hourStr);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
