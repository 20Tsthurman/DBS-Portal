"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { AvailabilityBlockRecord } from "@/lib/supabase";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import {
  createAvailabilityBlock,
  updateAvailabilityBlock,
} from "../_actions";
import { weekdayLabel } from "../_lib/dateMath";

interface AvailabilityBlockFormPanelProps {
  open: boolean;
  onClose: () => void;
  /** YYYY-MM-DD for one-off creation. */
  date?: string;
  /** 0–6 for recurring creation. */
  recurringWeekday?: number;
  /** Pre-fills fields and switches to update mode. */
  block?: AvailabilityBlockRecord;
}

interface FormValues {
  isBlocked: boolean;
  isAllDay: boolean;
  startTime: string;
  endTime: string;
  label: string;
}

const emptyValues: FormValues = {
  isBlocked: true,
  isAllDay: false,
  startTime: "09:00",
  endTime: "17:00",
  label: "",
};

function trimSeconds(t: string): string {
  return t.length > 5 ? t.slice(0, 5) : t;
}

function valuesFromBlock(block: AvailabilityBlockRecord): FormValues {
  const allDay = block.start_time === null;
  return {
    isBlocked: block.is_blocked,
    isAllDay: allDay,
    startTime: !allDay ? trimSeconds(block.start_time as string) : "09:00",
    endTime: !allDay ? trimSeconds(block.end_time as string) : "17:00",
    label: block.label ?? "",
  };
}

export function AvailabilityBlockFormPanel({
  open,
  onClose,
  date,
  recurringWeekday,
  block,
}: AvailabilityBlockFormPanelProps) {
  const router = useRouter();
  const isEdit = Boolean(block);
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetDate = block?.date ?? date ?? null;
  const targetWeekday = block?.recurring_weekday ?? recurringWeekday ?? null;

  useEffect(() => {
    if (open) {
      setValues(block ? valuesFromBlock(block) : emptyValues);
      setError(null);
    }
  }, [open, block]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!values.isAllDay) {
      if (!values.startTime || !values.endTime) {
        setError("Start and end times are required.");
        return;
      }
      if (values.endTime <= values.startTime) {
        setError("End time must be after start time.");
        return;
      }
    }

    const startTime = values.isAllDay ? null : values.startTime;
    const endTime = values.isAllDay ? null : values.endTime;
    const label = values.label.trim() || null;

    setSubmitting(true);
    try {
      const result = block
        ? await updateAvailabilityBlock(block.id, {
            startTime,
            endTime,
            label,
            isBlocked: values.isBlocked,
          })
        : await createAvailabilityBlock({
            date: targetDate ?? undefined,
            recurringWeekday: targetWeekday ?? undefined,
            startTime,
            endTime,
            label,
            isBlocked: values.isBlocked,
          });
      if (!result.ok) {
        setError(result.error ?? "Failed to save block.");
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSubmitting(false);
    }
  };

  const title = isEdit ? "Edit Block" : "Block Time";
  const submitIdle = isEdit ? "Save Changes" : "Save Block";
  const targetLabel = targetDate ? "Date" : "Weekday";
  const targetValue =
    targetDate !== null
      ? targetDate
      : targetWeekday !== null
        ? `Every ${weekdayLabel(targetWeekday)}`
        : "";

  return (
    <SlidePanel open={open} onClose={onClose} title={title}>
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <div>
            <p style={labelStyle}>{targetLabel}</p>
            <div
              style={{
                ...fieldStyle,
                background: "var(--surface-base)",
                color: "var(--text-body)",
              }}
            >
              {targetValue}
            </div>
          </div>

          <div>
            <span style={labelStyle}>This time is&hellip;</span>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {(
                [
                  { value: true, label: "Blocked" },
                  { value: false, label: "Available" },
                ] as { value: boolean; label: string }[]
              ).map((opt) => (
                <label
                  key={opt.label}
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
                    name="block-mode"
                    checked={values.isBlocked === opt.value}
                    onChange={() =>
                      setValues((v) => ({ ...v, isBlocked: opt.value }))
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <p
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              {values.isBlocked
                ? "When set, this means Kelsey is unavailable during this time."
                : "When set, this means Kelsey is available during this time. Used for recurring weekly availability windows like “available 1pm–3pm every Tuesday.”"}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="block-allday"
              type="checkbox"
              checked={values.isAllDay}
              onChange={(e) =>
                setValues((v) => ({ ...v, isAllDay: e.target.checked }))
              }
            />
            <label
              htmlFor="block-allday"
              style={{
                fontSize: 13,
                color: "var(--text-body)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              All day
            </label>
          </div>

          {!values.isAllDay && (
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="block-start" style={labelStyle}>
                  Start
                </label>
                <input
                  id="block-start"
                  type="time"
                  required
                  value={values.startTime}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, startTime: e.target.value }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="block-end" style={labelStyle}>
                  End
                </label>
                <input
                  id="block-end"
                  type="time"
                  required
                  value={values.endTime}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, endTime: e.target.value }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="block-label" style={labelStyle}>
              Internal Label
            </label>
            <input
              id="block-label"
              type="text"
              value={values.label}
              onChange={(e) =>
                setValues((v) => ({ ...v, label: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
              placeholder="e.g. School pickup"
            />
            <p
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              Visible only to you. Clients see &ldquo;Unavailable&rdquo; with no label.
            </p>
          </div>

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div className="pt-6">
          <Button
            type="submit"
            disabled={submitting}
            style={{ width: "100%" }}
          >
            {submitting ? "Saving…" : submitIdle}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}
