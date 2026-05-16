"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type {
  TimeBlockCategory,
  TimeBlockRecord,
} from "@/lib/supabase";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import {
  createTimeBlock,
  deleteTimeBlock,
  updateTimeBlock,
} from "../_actions";

interface TimeBlockFormPanelProps {
  mode: "create" | "edit";
  existing?: TimeBlockRecord;
  defaultDate?: string;
  defaultCategory?: TimeBlockCategory;
  clients: Array<{ id: string; name: string }>;
  closeHref: string;
}

interface FormValues {
  category: TimeBlockCategory;
  date: string;
  isAllDay: boolean;
  startTime: string;
  endTime: string;
  clientId: string;
  label: string;
  notes: string;
}

const ALL_DAY_START = "07:00";
const ALL_DAY_END = "21:00";
const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

const CATEGORY_OPTIONS: Array<{ value: TimeBlockCategory; label: string }> = [
  { value: "sonography", label: "Sonography" },
  { value: "work_block", label: "Work block" },
  { value: "blocked", label: "Blocked" },
];

function trimSeconds(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function valuesForCreate(
  defaultDate: string | undefined,
  defaultCategory: TimeBlockCategory | undefined
): FormValues {
  return {
    category: defaultCategory ?? "blocked",
    date: defaultDate ?? todayKey(),
    isAllDay: false,
    startTime: DEFAULT_START,
    endTime: DEFAULT_END,
    clientId: "",
    label: "",
    notes: "",
  };
}

function valuesForEdit(record: TimeBlockRecord): FormValues {
  const startTime = trimSeconds(record.start_time);
  const endTime = trimSeconds(record.end_time);
  const isAllDay = startTime === ALL_DAY_START && endTime === ALL_DAY_END;
  return {
    category: record.category,
    date: record.date,
    isAllDay,
    startTime,
    endTime,
    clientId: record.client_id ?? "",
    label: record.label ?? "",
    notes: record.notes ?? "",
  };
}

export function TimeBlockFormPanel({
  mode,
  existing,
  defaultDate,
  defaultCategory,
  clients,
  closeHref,
}: TimeBlockFormPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() =>
    mode === "edit" && existing
      ? valuesForEdit(existing)
      : valuesForCreate(defaultDate, defaultCategory)
  );
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Remembers the times the user typed before flipping "All day" on, so we can restore. */
  const savedTimes = useRef<{ start: string; end: string } | null>(null);

  // Initialize savedTimes when entering edit mode with an existing all-day record:
  // we don't have prior values to restore, so use the defaults.
  useEffect(() => {
    if (values.isAllDay && savedTimes.current === null) {
      savedTimes.current = { start: DEFAULT_START, end: DEFAULT_END };
    }
  }, [values.isAllDay]);

  const handleClose = () => {
    router.push(closeHref);
  };

  const handleAllDayToggle = (checked: boolean) => {
    setValues((v) => {
      if (checked) {
        // Remember the user's typed values so we can restore them.
        savedTimes.current = { start: v.startTime, end: v.endTime };
        return { ...v, isAllDay: true, startTime: ALL_DAY_START, endTime: ALL_DAY_END };
      }
      const restore = savedTimes.current ?? { start: DEFAULT_START, end: DEFAULT_END };
      return { ...v, isAllDay: false, startTime: restore.start, endTime: restore.end };
    });
  };

  const handleCategoryChange = (next: TimeBlockCategory) => {
    setValues((v) => ({
      ...v,
      category: next,
      // Switching away from work_block clears any selected client so the
      // server-side check doesn't reject the submission.
      clientId: next === "work_block" ? v.clientId : "",
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!values.date) {
      setError("Date is required.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
      setError("Date must be YYYY-MM-DD.");
      return;
    }
    if (!values.startTime || !values.endTime) {
      setError("Start and end times are required.");
      return;
    }
    if (values.endTime <= values.startTime) {
      setError("End time must be after start time.");
      return;
    }

    const payload = {
      date: values.date,
      startTime: values.startTime,
      endTime: values.endTime,
      category: values.category,
      clientId:
        values.category === "work_block" && values.clientId
          ? values.clientId
          : null,
      label: values.label.trim() || null,
      notes:
        values.category === "work_block" && values.notes.trim()
          ? values.notes.trim()
          : null,
    };

    setSubmitting(true);
    try {
      const result =
        mode === "edit" && existing
          ? await updateTimeBlock(existing.id, payload)
          : await createTimeBlock(payload);
      if (!result.ok) {
        setError(result.error ?? "Failed to save event.");
        return;
      }
      router.push(closeHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (mode !== "edit" || !existing) return;
    if (!window.confirm("Delete this event? This cannot be undone.")) return;

    setDeleting(true);
    try {
      const result = await deleteTimeBlock(existing.id);
      if (!result.ok) {
        setError(result.error ?? "Failed to delete event.");
        return;
      }
      router.push(closeHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setDeleting(false);
    }
  };

  const title = mode === "edit" ? "Edit event" : "Add event";
  const submitLabel = mode === "edit" ? "Save changes" : "Save event";

  return (
    <SlidePanel open onClose={handleClose} title={title}>
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <div>
            <span style={labelStyle}>Category</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {CATEGORY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="time-block-category"
                    value={opt.value}
                    checked={values.category === opt.value}
                    onChange={() => handleCategoryChange(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="time-block-date" style={labelStyle}>
              Date
            </label>
            <input
              id="time-block-date"
              type="date"
              required
              value={values.date}
              onChange={(e) =>
                setValues((v) => ({ ...v, date: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <input
              id="time-block-all-day"
              type="checkbox"
              checked={values.isAllDay}
              onChange={(e) => handleAllDayToggle(e.target.checked)}
            />
            <label
              htmlFor="time-block-all-day"
              style={{
                fontSize: 13,
                color: "var(--text-body)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              All day (7am – 9pm)
            </label>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="time-block-start" style={labelStyle}>
                Start
              </label>
              <input
                id="time-block-start"
                type="time"
                required
                min="07:00"
                max="21:00"
                value={values.startTime}
                disabled={values.isAllDay}
                onChange={(e) =>
                  setValues((v) => ({ ...v, startTime: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{
                  ...fieldStyle,
                  opacity: values.isAllDay ? 0.6 : 1,
                  cursor: values.isAllDay ? "not-allowed" : "auto",
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="time-block-end" style={labelStyle}>
                End
              </label>
              <input
                id="time-block-end"
                type="time"
                required
                min="07:00"
                max="21:00"
                value={values.endTime}
                disabled={values.isAllDay}
                onChange={(e) =>
                  setValues((v) => ({ ...v, endTime: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{
                  ...fieldStyle,
                  opacity: values.isAllDay ? 0.6 : 1,
                  cursor: values.isAllDay ? "not-allowed" : "auto",
                }}
              />
            </div>
          </div>

          {values.category === "work_block" && (
            <div>
              <label htmlFor="time-block-client" style={labelStyle}>
                Client
              </label>
              <select
                id="time-block-client"
                value={values.clientId}
                onChange={(e) =>
                  setValues((v) => ({ ...v, clientId: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              >
                <option value="">(no client)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="time-block-label" style={labelStyle}>
              Label
            </label>
            <input
              id="time-block-label"
              type="text"
              value={values.label}
              onChange={(e) =>
                setValues((v) => ({ ...v, label: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
              placeholder="Optional — e.g. School pickup"
            />
          </div>

          {values.category === "work_block" && (
            <div>
              <label htmlFor="time-block-notes" style={labelStyle}>
                Notes
              </label>
              <textarea
                id="time-block-notes"
                rows={4}
                value={values.notes}
                onChange={(e) =>
                  setValues((v) => ({ ...v, notes: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{ ...fieldStyle, resize: "vertical" }}
                placeholder="What are you working on?"
              />
            </div>
          )}

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div
          className="pt-6"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <Button
            type="submit"
            disabled={submitting || deleting}
            style={{ width: "100%" }}
          >
            {submitting ? "Saving…" : submitLabel}
          </Button>
          {mode === "edit" && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting || deleting}
              style={{
                width: "100%",
                padding: "10px 16px",
                border: "1px solid var(--status-danger)",
                color: "var(--status-danger)",
                backgroundColor: "transparent",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontFamily: "inherit",
                cursor:
                  submitting || deleting ? "not-allowed" : "pointer",
                opacity: submitting || deleting ? 0.6 : 1,
              }}
            >
              {deleting ? "Deleting…" : "Delete event"}
            </button>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}
