import Link from "next/link";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { getTaskDueCounts } from "@/app/owner/tasks/_lib/queries";

/**
 * Dashboard "Tasks due" flag. Overdue (danger when > 0) + Due today (amber when
 * > 0); both 0 collapses to a calm "All caught up" state. The whole card links
 * to /owner/tasks.
 *
 * The <Link> wrapper carries height:100% so DashboardCard's equal-height
 * behavior survives — the card still stretches to match its grid row-mate.
 */
export async function TasksDueWidget() {
  const { overdue, today } = await getTaskDueCounts();
  const allClear = overdue === 0 && today === 0;

  return (
    <Link
      href="/owner/tasks"
      aria-label="View tasks"
      style={{ display: "block", height: "100%", color: "inherit" }}
    >
      <DashboardCard eyebrow="TASKS" title="Tasks Due">
        {allClear ? (
          <div style={{ paddingTop: 4 }}>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-body)",
              }}
            >
              All caught up
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              Nothing overdue or due today.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, paddingTop: 4 }}>
            <DueStat
              label="Overdue"
              value={overdue}
              tone={overdue > 0 ? "var(--status-danger)" : "var(--text-muted)"}
            />
            <DueStat
              label="Due today"
              value={today}
              tone={today > 0 ? "var(--status-warning)" : "var(--text-muted)"}
            />
          </div>
        )}
      </DashboardCard>
    </Link>
  );
}

function DueStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <span
        style={{
          display: "block",
          fontFamily: "var(--font-playfair), serif",
          fontSize: 40,
          fontWeight: 500,
          color: tone,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: "var(--text-muted)",
        }}
      >
        {label}
      </p>
    </div>
  );
}
