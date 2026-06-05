import { DashboardCard } from "@/components/ui/DashboardCard";
import type { TaskWithMeta } from "../_lib/queries";
import { dueLabel } from "../_lib/format";

/**
 * Glance-only rail panel: the next few dated open tasks. Source is already
 * filtered (due_date present) and sliced by the page; rows are not interactive.
 * Flat DashboardCard shell, hairline-separated rows.
 */
export function UpcomingPanel({ items }: { items: TaskWithMeta[] }) {
  return (
    <DashboardCard eyebrow="TASKS" title="Upcoming">
      {items.length === 0 ? (
        <p
          style={{
            margin: 0,
            paddingTop: 4,
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          Nothing scheduled.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item, i) => {
            const due = dueLabel(item.todo.due_date, item.bucket);
            const dueColor =
              due.tone === "today"
                ? "var(--status-warning)"
                : "var(--text-muted)";
            return (
              <li
                key={item.todo.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {item.todo.title}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: dueColor,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {due.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardCard>
  );
}
