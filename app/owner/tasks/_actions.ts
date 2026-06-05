"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { dateKeyInTimezone } from "@/app/owner/calendar/_lib/timezone";
import type { ActionResult } from "@/lib/actions";
import type {
  ActiveTimerView,
  TaskCategory,
  TodoStatus,
} from "./_lib/queries";

const VALID_CATEGORIES: TaskCategory[] = [
  "editing",
  "planning",
  "filming",
  "admin",
  "communication",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared field shape for create + update (same inputs per the spec). */
export interface TaskInput {
  title: string;
  /** Optional FK to clients(id). Empty/undefined → clientless task. */
  client_id?: string | null;
  /** Optional; must be one of the five time_logs categories when present. */
  category?: TaskCategory | null;
  /** Optional YYYY-MM-DD; null/empty → no due date ("Later" bucket). */
  due_date?: string | null;
}

interface ValidatedTaskFields {
  title: string;
  client_id: string | null;
  category: TaskCategory | null;
  due_date: string | null;
}

// ---------------------------------------------------------------------------
// validateTaskFields — shared validation for create + update. Trims the title
// (required), rejects unknown categories and malformed dates, and verifies the
// referenced client actually exists. Returns the normalized fields or an error.
// Module-private: a "use server" file may only EXPORT async functions, so this
// helper and VALID_CATEGORIES stay unexported.
// ---------------------------------------------------------------------------
async function validateTaskFields(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  input: TaskInput
): Promise<
  { ok: true; fields: ValidatedTaskFields } | { ok: false; error: string }
> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };

  let category: TaskCategory | null = null;
  if (input.category) {
    if (!VALID_CATEGORIES.includes(input.category)) {
      return { ok: false, error: "Invalid category" };
    }
    category = input.category;
  }

  let due_date: string | null = null;
  if (input.due_date) {
    if (!DATE_RE.test(input.due_date)) {
      return { ok: false, error: "Due date must be in YYYY-MM-DD format" };
    }
    due_date = input.due_date;
  }

  let client_id: string | null = null;
  if (input.client_id) {
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .eq("id", input.client_id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Selected client does not exist" };
    client_id = input.client_id;
  }

  return { ok: true, fields: { title, client_id, category, due_date } };
}

// ---------------------------------------------------------------------------
// createTask — insert a new todo. status defaults to 'open' at the DB level;
// completed_at stays null.
// ---------------------------------------------------------------------------
export async function createTask(
  input: TaskInput
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = getSupabaseServiceClient();
  const validation = await validateTaskFields(supabase, input);
  if (!validation.ok) return { ok: false, error: validation.error };
  const { title, client_id, category, due_date } = validation.fields;

  const { data, error } = await supabase
    .from("todos")
    .insert({ title, client_id, category, due_date })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create task" };
  }

  revalidatePath("/owner/tasks");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

// ---------------------------------------------------------------------------
// updateTask — edit an existing todo's title / client / category / due date.
// Status + completed_at are owned by toggleTaskDone, not touched here.
// ---------------------------------------------------------------------------
export async function updateTask(
  id: string,
  input: TaskInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing task id" };

  const supabase = getSupabaseServiceClient();
  const validation = await validateTaskFields(supabase, input);
  if (!validation.ok) return { ok: false, error: validation.error };
  const { title, client_id, category, due_date } = validation.fields;

  const { error } = await supabase
    .from("todos")
    .update({ title, client_id, category, due_date })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/owner/tasks");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// toggleTaskDone — flip status open<->done. Going to 'done' stamps
// completed_at = now(); reopening nulls it. Logs are untouched.
// (Phase 3 will stop-log any running timer first; not in scope here.)
// ---------------------------------------------------------------------------
export async function toggleTaskDone(id: string): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing task id" };

  const supabase = getSupabaseServiceClient();

  const { data: existing, error: lookupError } = await supabase
    .from("todos")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return { ok: false, error: lookupError.message };
  if (!existing) return { ok: false, error: "Task not found" };

  const current = (existing as { status: TodoStatus }).status;
  const nextStatus: TodoStatus = current === "done" ? "open" : "done";
  const completed_at =
    nextStatus === "done" ? new Date().toISOString() : null;

  // Completing a task that's currently being timed: stop + log first (§4.4) so
  // the elapsed time is captured before the task leaves the active list.
  let stoppedTimer = false;
  if (nextStatus === "done") {
    const { data: timerRow } = await supabase
      .from("active_timer")
      .select("todo_id")
      .limit(1)
      .maybeSingle();
    const runningTodoId =
      (timerRow as { todo_id: string } | null)?.todo_id ?? null;
    if (runningTodoId === id) {
      const stop = await stopActiveTimer(supabase, guard.ownerLabel);
      if (!stop.ok) return { ok: false, error: stop.error };
      stoppedTimer = true;
    }
  }

  const { error } = await supabase
    .from("todos")
    .update({ status: nextStatus, completed_at })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/owner/tasks");
  if (stoppedTimer) revalidatePath("/owner/time");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// deleteTask — hard delete a todo. time_logs.source_todo_id is ON DELETE SET
// NULL, so any logged time survives in the time tracker (and active_timer will
// CASCADE once Phase 3 lands).
// ---------------------------------------------------------------------------
export async function deleteTask(id: string): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!id) return { ok: false, error: "Missing task id" };

  const supabase = getSupabaseServiceClient();

  // If THIS task is the one being timed, stop + log first so the elapsed time
  // is preserved. Deleting the todo first would CASCADE-delete active_timer and
  // silently discard the time; in this order the subsequent delete only
  // SET-NULLs time_logs.source_todo_id, so the log survives in the time tracker
  // (just unlinked from the now-deleted task). See §7.
  const { data: timerRow } = await supabase
    .from("active_timer")
    .select("todo_id")
    .limit(1)
    .maybeSingle();
  const runningTodoId =
    (timerRow as { todo_id: string } | null)?.todo_id ?? null;
  let stoppedTimer = false;
  if (runningTodoId === id) {
    const stop = await stopActiveTimer(supabase, guard.ownerLabel);
    if (!stop.ok) return { ok: false, error: stop.error };
    stoppedTimer = true;
  }

  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/owner/tasks");
  if (stoppedTimer) revalidatePath("/owner/time");
  return { ok: true };
}

// ===========================================================================
// TIMER
// ===========================================================================

/** Raw active_timer row shape (the table has 0 or 1 row). */
interface ActiveTimerRow {
  id: string;
  singleton: boolean;
  todo_id: string;
  client_id: string | null;
  category: TaskCategory | null;
  started_at: string;
  created_at: string;
}

/** Summary returned by a stop, for the pill's toast. */
export interface StopResult {
  loggedHours: number;
  clientName: string | null;
  category: TaskCategory;
}

// ---------------------------------------------------------------------------
// stopActiveTimer — module-private shared stop logic, reused by stopTimer,
// startTimer (auto-stop), toggleTaskDone, and deleteTask.
//
// SERVER-AUTHORITATIVE DURATION: elapsed is computed ONLY from the started_at
// value read OUT OF the active_timer DB row, diffed against the server's own
// Date.now(). No client-supplied elapsed value is ever accepted or trusted.
//
// NO CAPPING: the real elapsed time is logged as-is — a 9h runaway logs 9h. The
// 8h "runaway" treatment is a visual warning in the pill only (Step 3); this
// server logic never truncates, caps, or alters hours.
//
// Returns the stopped summary (for the toast) or null when nothing was running.
// ---------------------------------------------------------------------------
async function stopActiveTimer(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  ownerLabel: string
): Promise<
  { ok: true; stopped: StopResult | null } | { ok: false; error: string }
> {
  const { data: timerData, error: readError } = await supabase
    .from("active_timer")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const timer = timerData as ActiveTimerRow | null;
  if (!timer) return { ok: true, stopped: null };

  // Authoritative duration: server clock minus the DB's started_at. The only
  // time input is timer.started_at, read above straight from the row.
  const startedMs = new Date(timer.started_at).getTime();
  const elapsedSeconds = Math.max(0, (Date.now() - startedMs) / 1000);
  // round(seconds / 3600, 2) — real elapsed, NOT capped.
  const hours = Math.round((elapsedSeconds / 3600) * 100) / 100;

  // Category defaults to 'admin' when the task had none (decision 6).
  const category: TaskCategory = timer.category ?? "admin";

  // Task title for the log note. timer.todo_id always resolves: a deleted todo
  // would have CASCADE-removed this active_timer row before we got here.
  const { data: todoRow } = await supabase
    .from("todos")
    .select("title")
    .eq("id", timer.todo_id)
    .maybeSingle();
  const taskTitle = (todoRow as { title: string } | null)?.title ?? "Task";

  // Client name for the toast. time_logs.client_id is NOT NULL, so the log is
  // only writable when the snapshot client is present — which it always is,
  // since clients are soft-deleted, never hard-deleted (the cascade can't fire).
  let clientName: string | null = null;
  // NOTE: when client_id is null we SKIP the log insert and just clear the
  // timer — relying on that soft-delete assumption. If clients ever become
  // hard-deletable, this branch turns into a silent data-loss path.
  if (timer.client_id) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("id", timer.client_id)
      .maybeSingle();
    clientName = (clientRow as { name: string } | null)?.name ?? null;

    // Insert the real time_logs row (matches addTimeLogAction's columns + the
    // source_todo_id provenance link).
    const { error: logError } = await supabase.from("time_logs").insert({
      client_id: timer.client_id,
      logged_by: ownerLabel,
      date: dateKeyInTimezone(new Date()),
      hours,
      category,
      notes: `Task: ${taskTitle}`,
      source_todo_id: timer.todo_id,
    });
    if (logError) return { ok: false, error: logError.message };
  }

  // Clear the running timer (insert-then-delete order mirrors §4.3).
  const { error: deleteError } = await supabase
    .from("active_timer")
    .delete()
    .eq("id", timer.id);
  if (deleteError) return { ok: false, error: deleteError.message };

  return { ok: true, stopped: { loggedHours: hours, clientName, category } };
}

// ---------------------------------------------------------------------------
// startTimer — begin tracking a task. Requires the task to have a client_id
// (decision 4). Auto-stops + logs any already-running timer first (decision 3
// / §4.2 step 1), then inserts a fresh active_timer snapshotting the task's
// client + category. started_at + singleton default at the DB level.
// ---------------------------------------------------------------------------
export async function startTimer(todoId: string): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!todoId) return { ok: false, error: "Missing task id" };

  const supabase = getSupabaseServiceClient();

  const { data: todoData, error: todoError } = await supabase
    .from("todos")
    .select("id, client_id, category")
    .eq("id", todoId)
    .maybeSingle();
  if (todoError) return { ok: false, error: todoError.message };
  const todo = todoData as {
    id: string;
    client_id: string | null;
    category: TaskCategory | null;
  } | null;
  if (!todo) return { ok: false, error: "Task not found" };
  if (!todo.client_id) {
    return {
      ok: false,
      error: "Add a client to this task before starting a timer.",
    };
  }

  // Stop + log any timer already running (the single-timer rule).
  const stop = await stopActiveTimer(supabase, guard.ownerLabel);
  if (!stop.ok) return { ok: false, error: stop.error };

  const { error: insertError } = await supabase.from("active_timer").insert({
    todo_id: todo.id,
    client_id: todo.client_id,
    category: todo.category,
  });
  if (insertError) return { ok: false, error: insertError.message };

  revalidatePath("/owner/tasks");
  // Auto-stopping a previous timer wrote a log → refresh the time tracker too.
  if (stop.stopped) revalidatePath("/owner/time");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// stopTimer — stop + log the running timer. Returns the summary for the toast
// (null when nothing was running — treated as a successful no-op per §4.3).
// ---------------------------------------------------------------------------
export async function stopTimer(): Promise<ActionResult<StopResult | null>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = getSupabaseServiceClient();
  const stop = await stopActiveTimer(supabase, guard.ownerLabel);
  if (!stop.ok) return { ok: false, error: stop.error };

  revalidatePath("/owner/tasks");
  revalidatePath("/owner/time");
  return { ok: true, data: stop.stopped };
}

// ---------------------------------------------------------------------------
// getActiveTimer — the single running timer (joined to its task title + client
// name) or null. Read-only; called server-side by the owner layout to seed the
// top-bar TimerPill on every page load (§4.5).
// ---------------------------------------------------------------------------
export async function getActiveTimer(): Promise<ActiveTimerView | null> {
  const guard = await requireOwner();
  if (!guard.ok) return null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("active_timer")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const timer = data as ActiveTimerRow;

  const { data: todoRow } = await supabase
    .from("todos")
    .select("title")
    .eq("id", timer.todo_id)
    .maybeSingle();

  let clientName: string | null = null;
  if (timer.client_id) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("name")
      .eq("id", timer.client_id)
      .maybeSingle();
    clientName = (clientRow as { name: string } | null)?.name ?? null;
  }

  return {
    id: timer.id,
    todo_id: timer.todo_id,
    client_id: timer.client_id,
    category: timer.category,
    started_at: timer.started_at,
    taskTitle: (todoRow as { title: string } | null)?.title ?? "Task",
    clientName,
  };
}
