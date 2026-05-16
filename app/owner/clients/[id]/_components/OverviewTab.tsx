import type {
  PackageRecord,
  ProjectRecord,
  ShootRecord,
  TimeLogRecord,
} from "@/lib/supabase";
import { formatDateTime, formatHours } from "../../_lib/format";
import { StatCard } from "@/components/ui/StatCard";
import { PhaseTracker } from "./PhaseTracker";

interface OverviewTabProps {
  project: ProjectRecord | null;
  pkg: PackageRecord | null;
  hoursThisMonth: number;
  recentLogs: TimeLogRecord[];
  nextShoot: ShootRecord | null;
}

export function OverviewTab({
  project,
  pkg,
  hoursThisMonth,
  recentLogs,
  nextShoot,
}: OverviewTabProps) {
  const budget = pkg?.monthly_hours ?? null;
  const remaining =
    budget !== null ? Number((budget - hoursThisMonth).toFixed(2)) : null;
  const remainingDanger = remaining !== null && remaining < 0;

  return (
    <div className="space-y-8">
      <PhaseTracker current={project?.current_phase ?? null} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Hours This Month"
          value={formatHours(hoursThisMonth)}
        />
        <StatCard
          label="Hours Budget"
          value={budget !== null ? formatHours(budget) : "—"}
        />
        <StatCard
          label="Hours Remaining"
          value={remaining !== null ? formatHours(remaining) : "—"}
          tone={remainingDanger ? "danger" : "default"}
        />
        <StatCard
          label="Next Shoot"
          value={
            nextShoot ? (
              <span style={{ fontSize: 18 }}>
                {formatDateTime(nextShoot.scheduled_at)}
              </span>
            ) : (
              <span style={{ fontSize: 18 }}>None scheduled</span>
            )
          }
          hint={nextShoot?.location ?? undefined}
        />
      </div>

      <section>
        <p className="eyebrow mb-4">Recent Activity</p>
        {recentLogs.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            No time logged yet.
          </p>
        ) : (
          <ul
            className="border"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-raised)",
            }}
          >
            {recentLogs.map((log, index) => (
              <li
                key={log.id}
                className="flex items-center justify-between px-5 py-3"
                style={{
                  borderBottom:
                    index === recentLogs.length - 1
                      ? "none"
                      : "1px solid var(--border)",
                  fontSize: 14,
                  color: "var(--text-body)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "baseline",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-primary)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {log.date}
                  </span>
                  <span
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontSize: 11,
                      color: "var(--accent)",
                      fontWeight: 600,
                    }}
                  >
                    {log.category}
                  </span>
                  {log.notes && (
                    <span
                      style={{
                        color: "var(--text-body)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.notes}
                    </span>
                  )}
                </div>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {formatHours(Number(log.hours))}h
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
