"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import { friendlyDate } from "@/app/owner/calendar/_lib/dateMath";
import { requestShoot, type TimeOfDay } from "../_actions";

interface RequestShootFormPanelProps {
  open: boolean;
  onClose: () => void;
  /** YYYY-MM-DD, locally interpreted. Pre-selected on the calendar before opening. */
  defaultDate: string;
}

interface FormValues {
  timeOfDay: TimeOfDay;
  specificTime: string;
  location: string;
  notes: string;
}

const emptyValues: FormValues = {
  timeOfDay: "morning",
  specificTime: "",
  location: "",
  notes: "",
};

const TIME_BUCKET_HOURS: Record<Exclude<TimeOfDay, "specific">, number> = {
  morning: 9,
  afternoon: 13,
  evening: 17,
};

function parseDateStr(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildIso(
  dateStr: string,
  timeOfDay: TimeOfDay,
  specificTime: string
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);

  let hour: number;
  let minute = 0;
  if (timeOfDay === "specific") {
    const t = /^(\d{2}):(\d{2})$/.exec(specificTime);
    if (!t) return null;
    hour = Number(t[1]);
    minute = Number(t[2]);
  } else {
    hour = TIME_BUCKET_HOURS[timeOfDay];
  }

  const d = new Date(year, month, day, hour, minute, 0);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function RequestShootFormPanel({
  open,
  onClose,
  defaultDate,
}: RequestShootFormPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(emptyValues);
      setError(null);
    }
  }, [open]);

  const parsedDate = parseDateStr(defaultDate);
  const dateLabel = parsedDate ? friendlyDate(parsedDate) : defaultDate;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (values.timeOfDay === "specific" && !values.specificTime) {
      setError("Please choose a specific time.");
      return;
    }

    const iso = buildIso(defaultDate, values.timeOfDay, values.specificTime);
    if (!iso) {
      setError("Could not build a valid date & time.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestShoot({
        scheduledAt: iso,
        timeOfDay: values.timeOfDay,
        location: values.location.trim() || null,
        notes: values.notes.trim() || null,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to send request.");
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

  return (
    <SlidePanel open={open} onClose={onClose} title="Request a Shoot">
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <div>
            <label style={labelStyle}>Date</label>
            <div
              style={{
                padding: "8px 12px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-base)",
                fontSize: 14,
                color: "var(--text-primary)",
              }}
            >
              {dateLabel}
            </div>
          </div>

          <div>
            <span style={labelStyle}>Time of day</span>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {(
                [
                  { value: "morning", label: "Morning" },
                  { value: "afternoon", label: "Afternoon" },
                  { value: "evening", label: "Evening" },
                  { value: "specific", label: "Specific time" },
                ] satisfies { value: TimeOfDay; label: string }[]
              ).map((opt) => (
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
                    name="time-of-day"
                    value={opt.value}
                    checked={values.timeOfDay === opt.value}
                    onChange={() =>
                      setValues((v) => ({ ...v, timeOfDay: opt.value }))
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {values.timeOfDay === "specific" && (
            <div>
              <label htmlFor="request-specific-time" style={labelStyle}>
                Specific time
              </label>
              <input
                id="request-specific-time"
                type="time"
                required
                value={values.specificTime}
                onChange={(e) =>
                  setValues((v) => ({ ...v, specificTime: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              />
            </div>
          )}

          <div>
            <label htmlFor="request-location" style={labelStyle}>
              Location
            </label>
            <input
              id="request-location"
              type="text"
              value={values.location}
              onChange={(e) =>
                setValues((v) => ({ ...v, location: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="request-notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="request-notes"
              rows={4}
              placeholder="Anything Kelsey should know about this shoot?"
              value={values.notes}
              onChange={(e) =>
                setValues((v) => ({ ...v, notes: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </div>

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div className="pt-6">
          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
            style={{ width: "100%" }}
          >
            {submitting ? "Sending…" : "Send Request"}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}
