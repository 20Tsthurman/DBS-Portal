"use client";

import { useState, type CSSProperties } from "react";
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
import { dateKeyInTimezone } from "@/lib/date";
import { requestShoot } from "../_actions";

interface RequestShootFormPanelProps {
  /** YYYY-MM-DD to pre-fill, or undefined for empty. */
  defaultDate?: string;
  /** Where to navigate after successful submit or cancel. */
  closeHref: string;
}

type DurationPreset = "0.5" | "1" | "1.5" | "2" | "3" | "4" | "custom";

interface PresetOption {
  value: DurationPreset;
  label: string;
}

const PRESET_OPTIONS: PresetOption[] = [
  { value: "0.5", label: "30 minutes" },
  { value: "1", label: "1 hour" },
  { value: "1.5", label: "1.5 hours" },
  { value: "2", label: "2 hours" },
  { value: "3", label: "3 hours" },
  { value: "4", label: "4 hours" },
  { value: "custom", label: "Custom…" },
];

export function RequestShootFormPanel({
  defaultDate,
  closeHref,
}: RequestShootFormPanelProps) {
  const router = useRouter();

  const todayKey = dateKeyInTimezone(new Date());

  const [date, setDate] = useState<string>(defaultDate ?? "");
  const [startTime, setStartTime] = useState<string>("");
  const [durationPreset, setDurationPreset] = useState<DurationPreset>("1");
  const [customDuration, setCustomDuration] = useState<number>(1);
  const [location, setLocation] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    count: number;
  } | null>(null);

  const effectiveDuration =
    durationPreset === "custom" ? customDuration : Number(durationPreset);

  const handleClose = () => {
    router.push(closeHref);
  };

  const submit = async (acknowledgeConflict: boolean) => {
    setValidationError(null);
    setSubmitting(true);

    const result = await requestShoot({
      date,
      startTime,
      durationHours: effectiveDuration,
      location: location.trim() || null,
      notes: notes.trim() || null,
      acknowledgeConflict,
    });

    setSubmitting(false);

    if (result.ok) {
      router.push(closeHref);
      router.refresh();
      return;
    }

    // On the conflict-acknowledged retry we never expect another `conflict`
    // (acknowledge skips the check server-side), but defend against it by
    // treating it as a generic error so we don't render details.
    if (result.error === "conflict" && !acknowledgeConflict) {
      setPendingConflict({ count: result.conflictCount });
      return;
    }

    if (
      result.error === "validation" ||
      result.error === "auth" ||
      result.error === "internal"
    ) {
      setValidationError(result.message);
    } else {
      setValidationError("Something went wrong. Please try again.");
    }
    setPendingConflict(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await submit(false);
  };

  const handleSendAnyway = async () => {
    await submit(true);
  };

  const handlePickDifferent = () => {
    setPendingConflict(null);
  };

  return (
    <SlidePanel open onClose={handleClose} title="Request a Shoot">
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            Kelsey will review and confirm. You&apos;ll see the status on this page.
          </p>

          <div>
            <label htmlFor="request-date" style={labelStyle}>
              Date
            </label>
            <input
              id="request-date"
              type="date"
              required
              min={todayKey}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="request-start" style={labelStyle}>
              Start time
            </label>
            <input
              id="request-start"
              type="time"
              required
              min="07:00"
              max="20:30"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="request-duration" style={labelStyle}>
              Duration
            </label>
            <select
              id="request-duration"
              value={durationPreset}
              onChange={(e) =>
                setDurationPreset(e.target.value as DurationPreset)
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              {PRESET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {durationPreset === "custom" && (
              <input
                type="number"
                step={0.5}
                min={0.5}
                max={12}
                value={customDuration}
                onChange={(e) => setCustomDuration(Number(e.target.value))}
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{ ...fieldStyle, marginTop: 8 }}
                aria-label="Custom duration in hours"
              />
            )}
          </div>

          <div>
            <label htmlFor="request-location" style={labelStyle}>
              Location
            </label>
            <input
              id="request-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
              placeholder="e.g., Franklin, TN"
            />
          </div>

          <div>
            <label htmlFor="request-notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="request-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={{ ...fieldStyle, resize: "vertical" }}
              placeholder="Anything Kelsey should know?"
            />
          </div>

          {validationError && <div style={errorStyle}>{validationError}</div>}
        </div>

        <div
          className="pt-6"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {pendingConflict ? (
            <>
              <div style={conflictBannerStyle}>
                Kelsey has {pendingConflict.count} other commitment
                {pendingConflict.count > 1 ? "s" : ""} during this time. Send
                the request anyway?
              </div>
              <Button
                type="button"
                onClick={handleSendAnyway}
                disabled={submitting}
                style={{ width: "100%" }}
              >
                {submitting ? "Sending…" : "Send anyway"}
              </Button>
              <button
                type="button"
                onClick={handlePickDifferent}
                disabled={submitting}
                style={textLinkStyle}
              >
                Pick a different time
              </button>
            </>
          ) : (
            <>
              <Button
                type="submit"
                disabled={submitting}
                style={{ width: "100%" }}
              >
                {submitting ? "Sending…" : "Send request"}
              </Button>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                style={textLinkStyle}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </SlidePanel>
  );
}

const conflictBannerStyle: CSSProperties = {
  padding: "12px 14px",
  backgroundColor: "rgba(168, 120, 138, 0.14)",
  border: "1px solid var(--accent)",
  color: "var(--text-primary)",
  fontSize: 13,
  lineHeight: 1.5,
};

const textLinkStyle: CSSProperties = {
  alignSelf: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-body)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
  cursor: "pointer",
  padding: "4px 8px",
};
