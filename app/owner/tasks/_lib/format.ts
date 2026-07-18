import type { TaskBucket, TaskCategory } from "./queries";

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  editing: "Editing",
  planning: "Planning",
  filming: "Filming",
  admin: "Admin",
  communication: "Communication",
};

/** Ordered category list for the task form's optional category select. */
export const TASK_CATEGORIES: TaskCategory[] = [
  "editing",
  "planning",
  "filming",
  "admin",
  "communication",
];

export function categoryLabel(category: TaskCategory): string {
  return CATEGORY_LABELS[category];
}

export type DueTone = "overdue" | "today" | "muted";

export interface DueLabel {
  text: string;
  tone: DueTone;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Parse the YYYY-MM-DD parts directly (no `new Date(str)`) so there's no
// UTC→local shift — mirrors the approach in clients/_lib/format.formatDate.
function formatShortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const [, y, mo, d] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

/**
 * Label + tone for a task's due date, derived from its bucket so the wording
 * matches the grouping: overdue → red, today → amber, everything else muted.
 */
export function dueLabel(dueDate: string | null, bucket: TaskBucket): DueLabel {
  if (bucket === "today") return { text: "Today", tone: "today" };
  if (!dueDate) return { text: "No date", tone: "muted" };
  const short = formatShortDate(dueDate);
  if (bucket === "overdue") return { text: `Overdue · ${short}`, tone: "overdue" };
  return { text: short, tone: "muted" };
}

/**
 * Bare duration — "Xm" / "Xh" / "Xh Ym" — from summed logged hours, rounded to
 * whole minutes. Returns null when nothing is logged (caller hides it).
 *
 * Split out from `loggedLabel` so the mobile card can render this under a
 * "Logged" field label without the redundant "LOGGED  Logged 45m" stutter.
 */
export function loggedDuration(loggedHours: number): string | null {
  if (!loggedHours || loggedHours <= 0) return null;
  const totalMinutes = Math.round(loggedHours * 60);
  if (totalMinutes <= 0) return null;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${h}h` : `${h}h ${mins}m`;
}

/**
 * "Logged Xm" / "Logged Xh" / "Logged Xh Ym" — the self-describing form used
 * in the desktop row's inline meta strip, where there's no field label.
 */
export function loggedLabel(loggedHours: number): string | null {
  const duration = loggedDuration(loggedHours);
  return duration === null ? null : `Logged ${duration}`;
}
