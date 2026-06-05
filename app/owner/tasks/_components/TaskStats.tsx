import type { CSSProperties } from "react";

interface TaskStatsProps {
  total: number;
  overdue: number;
  dueThisWeek: number;
  completed: number;
}

/**
 * Top stat row for the tasks page: Total / Overdue / Due this week / Completed.
 * Flat tiles matching DashboardCard's border + surface + 24px padding (no
 * rounded corners, no shadow). Only the two "alarm" numbers carry status color:
 * Overdue → danger when > 0, Due this week → warning when > 0. Total reads as a
 * strong neutral headline; Completed is quiet/muted.
 */
export function TaskStats({
  total,
  overdue,
  dueThisWeek,
  completed,
}: TaskStatsProps) {
  return (
    <div className="task-stats">
      <StatTile label="Total tasks" value={total} color="var(--text-primary)" />
      <StatTile
        label="Overdue"
        value={overdue}
        color={overdue > 0 ? "var(--status-danger)" : "var(--text-muted)"}
      />
      <StatTile
        label="Due this week"
        value={dueThisWeek}
        color={dueThisWeek > 0 ? "var(--status-warning)" : "var(--text-muted)"}
      />
      <StatTile
        label="Completed"
        value={completed}
        color="var(--text-muted)"
      />

      <style>{`
        .task-stats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 24px;
        }
        @media (max-width: 1023px) {
          .task-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .task-stats { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="border"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span style={{ ...valueStyle, color }}>{value}</span>
    </div>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--text-muted)",
};

const valueStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 40,
  fontWeight: 500,
  letterSpacing: "-0.02em",
  lineHeight: 1,
};
