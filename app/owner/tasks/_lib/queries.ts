import {
  getSupabaseServiceClient,
  type TimeLogCategory,
} from "@/lib/supabase";
import {
  addDaysToDateKey,
  dateKeyInTimezone,
} from "@/app/owner/calendar/_lib/timezone";

// ---------------------------------------------------------------------------
// Types
//
// Todo record types live inside the tasks feature (not lib/supabase.ts) on
// purpose for this phase — see the Phase 2 scope note. The service client is
// untyped, so `.from("todos")` doesn't need the table registered in the
// `Database` map; rows are cast on read.
// ---------------------------------------------------------------------------

/** Tasks reuse the five time_logs categories verbatim (maps 1:1 on auto-log). */
export type TaskCategory = TimeLogCategory;

export type TodoStatus = "open" | "done";

export interface TodoRecord {
  id: string;
  title: string;
  client_id: string | null;
  category: TaskCategory | null;
  /** YYYY-MM-DD, or null = no due date ("Later" bucket). */
  due_date: string | null;
  status: TodoStatus;
  completed_at: string | null;
  created_at: string;
}

/** Due bucket, in display order. "later" also holds tasks with no due_date. */
export type TaskBucket = "overdue" | "today" | "week" | "later" | "done";

export interface TaskWithMeta {
  todo: TodoRecord;
  /** Client display name, or null for clientless tasks. */
  clientName: string | null;
  /** Sum of time_logs.hours whose source_todo_id = todo.id. 0 when none. */
  loggedHours: number;
  bucket: TaskBucket;
}

export interface GroupedTasks {
  overdue: TaskWithMeta[];
  today: TaskWithMeta[];
  week: TaskWithMeta[];
  later: TaskWithMeta[];
  done: TaskWithMeta[];
}

export interface ClientPickerOption {
  id: string;
  name: string;
}

/**
 * The single running timer, joined to its task title + client name for display.
 * Seeded server-side into the top-bar TimerPill; the pill ticks from
 * `started_at` client-side. `null` = no timer running.
 */
export interface ActiveTimerView {
  id: string;
  todo_id: string;
  client_id: string | null;
  category: TaskCategory | null;
  /** ISO timestamp the timer started; elapsed is derived from this. */
  started_at: string;
  taskTitle: string;
  clientName: string | null;
}

// ---------------------------------------------------------------------------
// Bucketing
//
// Rules (all comparisons are string compares on YYYY-MM-DD keys — `due_date`
// is a Postgres `date`, so this is correct and timezone-drift-free):
//   done    — status === 'done' (regardless of date)
//   later   — no due_date
//   overdue — due_date < today
//   today   — due_date === today
//   week    — today < due_date <= today + 7 days
//   later   — due_date > today + 7 days
// `today` / `weekEnd` are computed in PORTAL_TIMEZONE (America/Chicago).
// ---------------------------------------------------------------------------
function bucketFor(
  todo: Pick<TodoRecord, "status" | "due_date">,
  today: string,
  weekEnd: string
): TaskBucket {
  if (todo.status === "done") return "done";
  const due = todo.due_date;
  if (!due) return "later";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= weekEnd) return "week";
  return "later";
}

// Sort key for undated tasks so they sort after every dated one.
const FAR_FUTURE = "9999-12-31";

function byDueThenCreated(a: TaskWithMeta, b: TaskWithMeta): number {
  const ad = a.todo.due_date ?? FAR_FUTURE;
  const bd = b.todo.due_date ?? FAR_FUTURE;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.todo.created_at.localeCompare(b.todo.created_at);
}

// ---------------------------------------------------------------------------
// getTasks — every todo, with its client name + summed logged time, grouped
// into due buckets. Three round-trips: todos, the referenced clients, and the
// time_logs that point back at these todos via source_todo_id.
// ---------------------------------------------------------------------------
export async function getTasks(): Promise<GroupedTasks> {
  const supabase = getSupabaseServiceClient();

  const { data: todoRows, error: todosError } = await supabase
    .from("todos")
    .select("*");
  if (todosError) throw new Error(todosError.message);
  const todos = (todoRows ?? []) as TodoRecord[];

  // Client names for the referenced clients only (clientless tasks skip this).
  const clientIds = Array.from(
    new Set(
      todos
        .map((t) => t.client_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const clientNameById = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clientRows, error: clientsError } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", clientIds);
    if (clientsError) throw new Error(clientsError.message);
    for (const row of (clientRows ?? []) as { id: string; name: string }[]) {
      clientNameById.set(row.id, row.name);
    }
  }

  // Logged-hours sum per task, from the time_logs provenance column.
  const todoIds = todos.map((t) => t.id);
  const loggedByTodo = new Map<string, number>();
  if (todoIds.length > 0) {
    const { data: logRows, error: logsError } = await supabase
      .from("time_logs")
      .select("source_todo_id, hours")
      .in("source_todo_id", todoIds);
    if (logsError) throw new Error(logsError.message);
    for (const row of (logRows ?? []) as {
      source_todo_id: string | null;
      hours: number;
    }[]) {
      if (!row.source_todo_id) continue;
      loggedByTodo.set(
        row.source_todo_id,
        (loggedByTodo.get(row.source_todo_id) ?? 0) + Number(row.hours)
      );
    }
  }

  const today = dateKeyInTimezone(new Date());
  const weekEnd = addDaysToDateKey(today, 7);

  const grouped: GroupedTasks = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    done: [],
  };

  for (const todo of todos) {
    const bucket = bucketFor(todo, today, weekEnd);
    grouped[bucket].push({
      todo,
      clientName: todo.client_id
        ? clientNameById.get(todo.client_id) ?? null
        : null,
      loggedHours: loggedByTodo.get(todo.id) ?? 0,
      bucket,
    });
  }

  // Active buckets: soonest-due first, then oldest-created. Completed: most
  // recently completed first.
  grouped.overdue.sort(byDueThenCreated);
  grouped.today.sort(byDueThenCreated);
  grouped.week.sort(byDueThenCreated);
  grouped.later.sort(byDueThenCreated);
  grouped.done.sort((a, b) => {
    const ac = a.todo.completed_at ?? a.todo.created_at;
    const bc = b.todo.completed_at ?? b.todo.created_at;
    return bc.localeCompare(ac);
  });

  return grouped;
}

// ---------------------------------------------------------------------------
// fetchClientsForPicker — lightweight {id, name} list for the task form's
// optional client select, sorted by name.
// ---------------------------------------------------------------------------
export async function fetchClientsForPicker(): Promise<ClientPickerOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientPickerOption[];
}

export interface TaskDueCounts {
  overdue: number;
  today: number;
}

// ---------------------------------------------------------------------------
// getTaskDueCounts — count-only sibling of getTasks for the dashboard "Tasks
// due" flag. Selects just status + due_date (no client / time_logs joins) and
// reuses the SAME bucketFor rules, so these counts always match what the tasks
// page shows in its Overdue / Today groups.
// ---------------------------------------------------------------------------
export async function getTaskDueCounts(): Promise<TaskDueCounts> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("todos")
    .select("status, due_date");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Pick<TodoRecord, "status" | "due_date">[];

  const today = dateKeyInTimezone(new Date());
  const weekEnd = addDaysToDateKey(today, 7);

  let overdue = 0;
  let dueToday = 0;
  for (const row of rows) {
    const bucket = bucketFor(row, today, weekEnd);
    if (bucket === "overdue") overdue++;
    else if (bucket === "today") dueToday++;
  }
  return { overdue, today: dueToday };
}
