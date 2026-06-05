"use client";

import { useState } from "react";
import type {
  ClientPickerOption,
  GroupedTasks,
  TaskWithMeta,
} from "../_lib/queries";
import { TaskRow } from "./TaskRow";
import { TaskFormPanel } from "./TaskFormPanel";

interface TaskListProps {
  grouped: GroupedTasks;
  clients: ClientPickerOption[];
  /** todo_id of the task currently being timed, or null. */
  activeTodoId: string | null;
}

const GROUPS: ReadonlyArray<{ key: keyof GroupedTasks; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "done", label: "Completed" },
];

export function TaskList({ grouped, clients, activeTodoId }: TaskListProps) {
  // One shared edit panel for the whole list, keyed on the task being edited.
  const [editingTask, setEditingTask] = useState<TaskWithMeta | null>(null);

  return (
    <>
      <div className="space-y-8">
        {GROUPS.map(({ key, label }) => {
          const items = grouped[key];
          if (items.length === 0) return null;
          const isDone = key === "done";
          return (
            <section key={key} style={{ opacity: isDone ? 0.6 : 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <h2
                  style={{
                    fontFamily: "var(--font-playfair), serif",
                    fontSize: 18,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  {label}
                </h2>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {items.length}
                </span>
              </div>

              <div
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--surface-raised)",
                }}
              >
                {items.map((task) => (
                  <TaskRow
                    key={task.todo.id}
                    task={task}
                    isTracking={task.todo.id === activeTodoId}
                    onEdit={(t) => setEditingTask(t)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <TaskFormPanel
        open={editingTask !== null}
        onClose={() => setEditingTask(null)}
        mode="edit"
        clients={clients}
        initialValues={
          editingTask
            ? {
                id: editingTask.todo.id,
                title: editingTask.todo.title,
                client_id: editingTask.todo.client_id,
                category: editingTask.todo.category,
                due_date: editingTask.todo.due_date,
              }
            : undefined
        }
      />

      <style>{`
        .task-row:last-child {
          border-bottom: none;
        }
        .task-row:hover {
          background-color: var(--surface-base);
        }
        /* Start button: forest-green outline that fills on hover. */
        .task-start-btn {
          background-color: transparent;
          color: var(--sidebar-bg);
          border: 1px solid var(--sidebar-bg);
          padding: 5px 14px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-family: inherit;
          cursor: pointer;
          transition: background-color 120ms ease-out, color 120ms ease-out;
        }
        .task-start-btn:hover:not(:disabled) {
          background-color: var(--sidebar-bg);
          color: #FFFFFF;
        }
        .task-start-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }
        /* Tracking indicator dot — pulses (CSS only, no per-row JS tick). */
        .task-tracking-dot {
          width: 7px;
          height: 7px;
          background-color: var(--sidebar-bg);
          flex: 0 0 auto;
          animation: task-pulse 1.4s ease-in-out infinite;
        }
        @keyframes task-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
