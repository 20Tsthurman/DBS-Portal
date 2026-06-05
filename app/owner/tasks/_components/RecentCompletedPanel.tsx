import { DashboardCard } from "@/components/ui/DashboardCard";
import type { TaskWithMeta } from "../_lib/queries";

/**
 * Glance-only rail panel: the most recently completed tasks (title only). Source
 * is grouped.done (already completed_at desc), sliced by the page. Flat
 * DashboardCard shell, hairline-separated rows.
 */
export function RecentCompletedPanel({ items }: { items: TaskWithMeta[] }) {
  return (
    <DashboardCard eyebrow="TASKS" title="Recently Completed">
      {items.length === 0 ? (
        <p
          style={{
            margin: 0,
            paddingTop: 4,
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          No completed tasks yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item, i) => (
            <li
              key={item.todo.id}
              style={{
                padding: "10px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                fontSize: 14,
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.todo.title}
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
