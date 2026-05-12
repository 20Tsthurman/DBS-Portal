"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import type { TimeLogCategory, TimeLogRecord } from "@/lib/supabase";
import {
  addTimeLogAction,
  deleteTimeLogAction,
} from "../../_actions";
import { SlidePanel } from "../../_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "../../_components/formStyles";
import { formatHours } from "../../_lib/format";

interface TimeTabProps {
  clientId: string;
  initialLogs: TimeLogRecord[];
}

const CATEGORIES: { value: TimeLogCategory; label: string }[] = [
  { value: "editing", label: "Editing" },
  { value: "planning", label: "Planning" },
  { value: "filming", label: "Filming" },
  { value: "admin", label: "Admin" },
  { value: "communication", label: "Communication" },
];

function todayIso(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset();
  return new Date(now.getTime() - tz * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function TimeTab({ clientId, initialLogs }: TimeTabProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [hours, setHours] = useState<string>("1");
  const [category, setCategory] = useState<TimeLogCategory>("editing");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const totals = useMemo(() => {
    const map = new Map<TimeLogCategory, number>();
    let total = 0;
    for (const log of initialLogs) {
      const h = Number(log.hours);
      total += h;
      map.set(log.category, (map.get(log.category) ?? 0) + h);
    }
    return { total, perCategory: map };
  }, [initialLogs]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsedHours = Number(hours);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      setError("Hours must be greater than 0.");
      return;
    }
    startTransition(async () => {
      const result = await addTimeLogAction({
        clientId,
        date,
        hours: parsedHours,
        category,
        notes,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to log time.");
        return;
      }
      setOpen(false);
      setHours("1");
      setNotes("");
      setDate(todayIso());
      setCategory("editing");
    });
  };

  const handleDelete = (logId: string) => {
    if (!confirm("Delete this time entry?")) return;
    startTransition(async () => {
      await deleteTimeLogAction(logId, clientId);
    });
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="eyebrow">Time Log</p>
        <Button type="button" onClick={() => setOpen(true)}>
          Log Time
        </Button>
      </div>

      {initialLogs.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          No time logged yet.
        </p>
      ) : (
        <div
          className="border"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Hours</th>
                <th>Notes</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {log.date}
                  </td>
                  <td style={{ textTransform: "capitalize" }}>{log.category}</td>
                  <td>{formatHours(Number(log.hours))}</td>
                  <td>{log.notes ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => handleDelete(log.id)}
                      disabled={isPending}
                      style={{
                        color: "var(--status-danger)",
                        fontSize: 13,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        backgroundColor: "transparent",
                        border: "none",
                        cursor: isPending ? "not-allowed" : "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        className="mt-6 border px-5 py-4"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface-raised)",
        }}
      >
        <p className="eyebrow mb-3">Summary</p>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              Total
            </span>
            <span
              style={{
                marginLeft: 8,
                color: "var(--text-primary)",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {formatHours(totals.total)}h
            </span>
          </div>
          {CATEGORIES.map((cat) => (
            <div key={cat.value}>
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {cat.label}
              </span>
              <span
                style={{
                  marginLeft: 8,
                  color: "var(--text-body)",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {formatHours(totals.perCategory.get(cat.value) ?? 0)}h
              </span>
            </div>
          ))}
        </div>
      </div>

      <SlidePanel
        open={open}
        onClose={() => setOpen(false)}
        title="Log Time"
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex-1 space-y-5">
            <div>
              <label htmlFor="log-date" style={labelStyle}>
                Date
              </label>
              <input
                id="log-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              />
            </div>
            <div>
              <label htmlFor="log-hours" style={labelStyle}>
                Hours
              </label>
              <input
                id="log-hours"
                type="number"
                required
                min="0.5"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              />
            </div>
            <div>
              <label htmlFor="log-category" style={labelStyle}>
                Category
              </label>
              <select
                id="log-category"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as TimeLogCategory)
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="log-notes" style={labelStyle}>
                Notes (optional)
              </label>
              <textarea
                id="log-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onFocus={applyFocus}
                onBlur={clearFocus}
                rows={4}
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </div>
            {error && <div style={errorStyle}>{error}</div>}
          </div>
          <div className="pt-6">
            <Button
              type="submit"
              disabled={isPending}
              style={{ width: "100%" }}
            >
              {isPending ? "Saving…" : "Save Time Entry"}
            </Button>
          </div>
        </form>
      </SlidePanel>
    </div>
  );
}
