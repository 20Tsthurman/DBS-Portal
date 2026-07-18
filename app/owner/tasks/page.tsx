import { fetchClientsForPicker, getTasks } from "./_lib/queries";
import { getActiveTimer } from "./_actions";
import { AddTaskButton } from "./_components/AddTaskButton";
import { TaskList } from "./_components/TaskList";
import { TaskStats } from "./_components/TaskStats";
import { UpcomingPanel } from "./_components/UpcomingPanel";
import { RecentCompletedPanel } from "./_components/RecentCompletedPanel";

export const dynamic = "force-dynamic";

export default async function OwnerTasksPage() {
  const [grouped, clients, activeTimer] = await Promise.all([
    getTasks(),
    fetchClientsForPicker(),
    getActiveTimer(),
  ]);
  const activeTodoId = activeTimer?.todo_id ?? null;

  const total =
    grouped.overdue.length +
    grouped.today.length +
    grouped.week.length +
    grouped.later.length +
    grouped.done.length;

  // Stat-row counts, all derived from the already-fetched grouped result.
  const dueThisWeek = grouped.today.length + grouped.week.length;

  // Rail panels, also derived from `grouped` (no extra queries). Upcoming =
  // next 5 DATED open tasks (filter before slicing so undated never pads it);
  // the buckets are already due-ascending, so the concat stays ordered.
  const upcoming = [...grouped.today, ...grouped.week, ...grouped.later]
    .filter((t) => t.todo.due_date)
    .slice(0, 5);
  const recentCompleted = grouped.done.slice(0, 5);

  return (
    <section>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Owner — Tasks</p>
          <h1 className="page-title">Tasks</h1>
        </div>
        <AddTaskButton clients={clients} />
      </header>

      {total === 0 ? (
        <div
          className="flex flex-col items-center justify-center border px-8 py-20 text-center"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          <p
            style={{
              color: "var(--text-body)",
              fontSize: "15px",
              marginBottom: 20,
            }}
          >
            No tasks yet. Add your first task to start planning.
          </p>
          <AddTaskButton clients={clients} label="Add Your First Task" />
        </div>
      ) : (
        <>
          <TaskStats
            total={total}
            overdue={grouped.overdue.length}
            dueThisWeek={dueThisWeek}
            completed={grouped.done.length}
          />

          <div className="tasks-layout">
            <div className="tasks-main">
              <TaskList
                grouped={grouped}
                clients={clients}
                activeTodoId={activeTodoId}
              />
            </div>
            <aside className="tasks-rail">
              <UpcomingPanel items={upcoming} />
              <RecentCompletedPanel items={recentCompleted} />
            </aside>
          </div>

          <style>{`
            .tasks-layout {
              display: grid;
              grid-template-columns: repeat(12, minmax(0, 1fr));
              gap: 24px;
              margin-top: 24px;
            }
            .tasks-main { grid-column: span 8; min-width: 0; }
            .tasks-rail {
              grid-column: span 4;
              min-width: 0;
              display: flex;
              flex-direction: column;
              gap: 24px;
            }
            @media (max-width: 1023px) {
              .tasks-layout { grid-template-columns: 1fr; }
              .tasks-main,
              .tasks-rail { grid-column: 1 / -1; }
            }
          `}</style>
        </>
      )}
    </section>
  );
}
