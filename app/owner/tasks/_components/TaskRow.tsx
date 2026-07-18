"use client";

import { useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  MobileCard,
  MobileCardActions,
  MobileCardField,
  MobileCardHeader,
} from "@/components/ui/MobileCard";
import type { TaskWithMeta } from "../_lib/queries";
import {
  categoryLabel,
  dueLabel,
  loggedDuration,
  loggedLabel,
} from "../_lib/format";
import { deleteTask, startTimer, toggleTaskDone } from "../_actions";

interface TaskRowProps {
  task: TaskWithMeta;
  /** True when this task is the one currently being timed. */
  isTracking: boolean;
  onEdit: (task: TaskWithMeta) => void;
}

/**
 * Toggle / start / delete for one task. Shared verbatim by the desktop row and
 * the mobile card so the two presentations can never drift onto different
 * actions — in particular Start is the same `startTimer` server action feeding
 * the same persistent <TimerPill/> in the owner top bar. Stop deliberately has
 * no control here; it lives on that pill.
 *
 * Each presentation calls this independently and so owns its own transition
 * state. That's correct rather than wasteful: only one of the two is ever
 * visible (`hidden lg:block` / `lg:hidden`), so their pending flags never need
 * to agree.
 */
function useTaskActions(todo: TaskWithMeta["todo"]) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(async () => {
      const res = await toggleTaskDone(todo.id);
      if (res.ok) router.refresh();
    });
  };

  const handleStart = () => {
    startTransition(async () => {
      const res = await startTimer(todo.id);
      if (res.ok) router.refresh();
      else console.error("[tasks] startTimer failed:", res.error);
    });
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete "${todo.title}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteTask(todo.id);
      if (res.ok) router.refresh();
    });
  };

  return { isPending, handleToggle, handleStart, handleDelete };
}

/** Presentation-independent derivations shared by the row and the card. */
function useTaskDisplay(task: TaskWithMeta) {
  const { todo, clientName, loggedHours, bucket } = task;
  const done = todo.status === "done";
  // Start is only offered on open tasks that have a client (decision 4).
  const canStart = !done && Boolean(todo.client_id);

  const due = dueLabel(todo.due_date, bucket);
  const cat = todo.category ? categoryLabel(todo.category) : null;
  // Mauve "Client · Category" badge — only when a client is attached; the
  // category suffix shows only when set.
  const badgeText = clientName
    ? cat
      ? `${clientName} · ${cat}`
      : clientName
    : null;

  const dueColor =
    due.tone === "overdue"
      ? "var(--status-danger)"
      : due.tone === "today"
        ? "var(--status-warning)"
        : "var(--text-muted)";

  return { todo, done, canStart, due, dueColor, badgeText, loggedHours };
}

/** Pulsing dot + "Tracking" caption. Shared so the two views stay in step. */
function TrackingIndicator() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--sidebar-bg)",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" className="task-tracking-dot" />
      Tracking
    </span>
  );
}

export function TaskRow({ task, isTracking, onEdit }: TaskRowProps) {
  const { todo, done, canStart, due, dueColor, badgeText, loggedHours } =
    useTaskDisplay(task);
  const { isPending, handleToggle, handleStart, handleDelete } =
    useTaskActions(todo);
  const logged = loggedLabel(loggedHours);

  return (
    <div
      className="task-row"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        // Tracking highlight: forest-green left rail + faint tint. A 3px
        // transparent rail on every row keeps content aligned when toggled.
        borderLeft: isTracking
          ? "3px solid var(--sidebar-bg)"
          : "3px solid transparent",
        backgroundColor: isTracking ? "rgba(27,56,39,0.06)" : undefined,
        opacity: isPending ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={done}
        onChange={handleToggle}
        disabled={isPending}
        aria-label={done ? "Reopen task" : "Mark task done"}
        style={{
          marginTop: 3,
          width: 16,
          height: 16,
          accentColor: "var(--accent)",
          cursor: isPending ? "default" : "pointer",
          flex: "0 0 auto",
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: done ? "var(--text-muted)" : "var(--text-primary)",
            textDecoration: done ? "line-through" : "none",
            wordBreak: "break-word",
          }}
        >
          {todo.title}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
          }}
        >
          {badgeText && <span style={badgeStyle}>{badgeText}</span>}
          <span style={{ fontSize: 12, fontWeight: 600, color: dueColor }}>
            {due.text}
          </span>
          {logged && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {logged}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 14,
          flex: "0 0 auto",
        }}
      >
        {isTracking ? (
          <TrackingIndicator />
        ) : canStart ? (
          <button
            type="button"
            className="task-start-btn"
            onClick={handleStart}
            disabled={isPending}
          >
            Start
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => onEdit(task)}
          style={{ ...actionStyle, color: "var(--accent)" }}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          style={{
            ...actionStyle,
            color: "var(--status-danger)",
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * Phone rendering of the same task. Mirrors the Shoots page card vocabulary
 * (header → fields → actions); `MobileCardActions` supplies the 44px minimum
 * on every button it wraps, which is why Start/Edit/Delete reuse the existing
 * `.task-start-btn` / `actionStyle` treatments unchanged.
 */
export function TaskCard({ task, isTracking, onEdit }: TaskRowProps) {
  const { todo, done, canStart, due, dueColor, badgeText, loggedHours } =
    useTaskDisplay(task);
  const { isPending, handleToggle, handleStart, handleDelete } =
    useTaskActions(todo);
  const logged = loggedDuration(loggedHours);

  return (
    <MobileCard
      style={{
        opacity: isPending ? 0.55 : 1,
        // Same tracking treatment as the desktop row, via the accent-rail
        // idiom MobileCard already supports (cf. pinned clients). Spread
        // conditionally: MobileCard merges this object *after* its own
        // defaults, so an explicit `backgroundColor: undefined` would strip
        // the card's surface-raised fill rather than leave it in place.
        ...(isTracking
          ? {
              borderLeftWidth: 3,
              borderLeftColor: "var(--sidebar-bg)",
              backgroundColor: "rgba(27,56,39,0.06)",
            }
          : null),
      }}
    >
      <MobileCardHeader
        title={
          <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
            {/* The bare 16px checkbox the desktop row uses is far under the
                44px touch minimum, so on touch it gets a 44px hit area from a
                wrapping label. Negative margins pull that box back against the
                card's 16px padding so the title still reads flush. */}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                height: 44,
                margin: "-11px 0 -11px -12px",
                flex: "0 0 auto",
                cursor: isPending ? "default" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={done}
                onChange={handleToggle}
                disabled={isPending}
                aria-label={done ? "Reopen task" : "Mark task done"}
                style={{
                  width: 18,
                  height: 18,
                  accentColor: "var(--accent)",
                  cursor: "inherit",
                }}
              />
            </label>
            <span
              style={{
                minWidth: 0,
                color: done ? "var(--text-muted)" : undefined,
                textDecoration: done ? "line-through" : "none",
              }}
            >
              {todo.title}
            </span>
          </div>
        }
        badge={isTracking ? <TrackingIndicator /> : undefined}
        subtitle={badgeText ? <span style={badgeStyle}>{badgeText}</span> : undefined}
      />

      <MobileCardField label="Due">
        <span style={{ fontWeight: 600, color: dueColor }}>{due.text}</span>
      </MobileCardField>
      {logged && <MobileCardField label="Logged">{logged}</MobileCardField>}

      <MobileCardActions align="end">
        {canStart && !isTracking && (
          <button
            type="button"
            className="task-start-btn"
            onClick={handleStart}
            disabled={isPending}
          >
            Start
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(task)}
          style={{ ...actionStyle, color: "var(--accent)" }}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          style={{
            ...actionStyle,
            color: "var(--status-danger)",
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}
        >
          Delete
        </button>
      </MobileCardActions>
    </MobileCard>
  );
}

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
};

// Matches the quiet uppercase text-action affordance used across the owner UI.
const actionStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontFamily: "inherit",
  cursor: "pointer",
};
