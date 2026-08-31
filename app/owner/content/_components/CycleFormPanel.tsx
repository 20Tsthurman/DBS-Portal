"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import { formatMonthLabel } from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import {
  createContentCycleAction,
  updateContentCycleAction,
} from "../_actions";
import type { CycleWithClient } from "../_lib/queries";

interface CycleFormPanelProps {
  open: boolean;
  onClose: () => void;
  /** Present = edit that cycle; absent = create one for clientId + monthKey. */
  cycle: CycleWithClient | null;
  clientId: string | null;
  clientName: string;
  monthKey: string;
}

interface FormValues {
  includedRounds: string;
  extraRoundPrice: string;
  revisionDeadline: string;
}

const DEFAULT_INCLUDED_ROUNDS = "1";

/**
 * The stored instant -> the `<input type="date">` value.
 *
 * Read through PORTAL_TIMEZONE, not off the raw Date. The deadline is stored
 * at 23:59 Central, which in UTC is the FOLLOWING day for most of the year —
 * `toISOString().slice(0,10)` would show Kelsey a date one day later than the
 * one she picked, and saving that unchanged form would walk the deadline
 * forward a day on every edit.
 */
function deadlineInputValue(iso: string | null): string {
  if (!iso) return "";
  return dateKeyInTimezone(new Date(iso));
}

function valuesFor(cycle: CycleWithClient | null): FormValues {
  if (!cycle) {
    return {
      includedRounds: DEFAULT_INCLUDED_ROUNDS,
      extraRoundPrice: "",
      revisionDeadline: "",
    };
  }
  return {
    includedRounds: String(cycle.included_rounds),
    extraRoundPrice:
      cycle.extra_round_price === null ? "" : String(cycle.extra_round_price),
    revisionDeadline: deadlineInputValue(cycle.revision_deadline),
  };
}

/**
 * Create/edit the month's cycle.
 *
 * `revision_deadline` lives HERE rather than inside the Release flow, and the
 * reason is spec §4.3: extending a deadline "does not require re-release, does
 * not reset the cycle, and does not affect any client progress". A deadline
 * that could only be set at Release would make every extension a
 * unrelease/re-release round trip, which would pull the queue out from under a
 * client mid-review to change one date. Release refuses to fire while the
 * field is empty (see `evaluateReleaseGate`), so the requirement is enforced
 * without the field having to live inside the release step.
 */
export function CycleFormPanel({
  open,
  onClose,
  cycle,
  clientId,
  clientName,
  monthKey,
}: CycleFormPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => valuesFor(cycle));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the panel opens so a cancelled edit doesn't leak its
  // values into the next open.
  useEffect(() => {
    if (!open) return;
    setValues(valuesFor(cycle));
    setError(null);
  }, [open, cycle]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const includedRounds = Number(values.includedRounds);
    if (!Number.isInteger(includedRounds) || includedRounds < 0) {
      setError("Included rounds must be a whole number.");
      return;
    }
    const trimmedDeadline = values.revisionDeadline.trim();
    const trimmedPrice = values.extraRoundPrice.trim();
    const extraRoundPrice = trimmedPrice === "" ? null : Number(trimmedPrice);
    if (extraRoundPrice !== null && !(extraRoundPrice >= 0)) {
      setError("Extra round price must be zero or more.");
      return;
    }

    setSubmitting(true);
    const result = cycle
      ? await updateContentCycleAction({
          cycleId: cycle.id,
          includedRounds,
          extraRoundPrice,
          revisionDeadline: trimmedDeadline === "" ? null : trimmedDeadline,
        })
      : await createContentCycleAction({
          clientId: clientId ?? "",
          monthKey,
          includedRounds,
          extraRoundPrice,
          revisionDeadline: trimmedDeadline === "" ? null : trimmedDeadline,
        });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save cycle.");
      return;
    }
    onClose();
    router.refresh();
  };

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title={cycle ? "Edit cycle" : "Create cycle"}
    >
      <form onSubmit={handleSubmit} className="flex h-full flex-col">
        <div className="flex-1 space-y-5">
          <div>
            <span style={labelStyle}>Cycle</span>
            <p style={readOnlyStyle}>
              {clientName || "—"} · {formatMonthLabel(monthKey)}
            </p>
            <p style={helperStyle}>
              One cycle per client per month.
            </p>
          </div>

          <div>
            <label htmlFor="cycle-revision-deadline" style={labelStyle}>
              Review deadline
            </label>
            <input
              id="cycle-revision-deadline"
              type="date"
              value={values.revisionDeadline}
              onChange={(e) =>
                setValues((v) => ({ ...v, revisionDeadline: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
            <p style={helperStyle}>
              Reviews close at the end of this day. Required before the month
              can be released. Changing it later is a single edit — it does not
              re-release the month or affect anything the client has already
              done.
            </p>
          </div>

          <div>
            <label htmlFor="cycle-included-rounds" style={labelStyle}>
              Included revision rounds
            </label>
            <input
              id="cycle-included-rounds"
              type="number"
              min={0}
              step={1}
              required
              value={values.includedRounds}
              onChange={(e) =>
                setValues((v) => ({ ...v, includedRounds: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
            <p style={helperStyle}>
              Rounds beyond this are billable.
            </p>
          </div>

          <div>
            <label htmlFor="cycle-extra-round-price" style={labelStyle}>
              Extra round price
            </label>
            <input
              id="cycle-extra-round-price"
              type="number"
              min={0}
              step="0.01"
              placeholder="Not set"
              value={values.extraRoundPrice}
              onChange={(e) =>
                setValues((v) => ({ ...v, extraRoundPrice: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
            <p style={helperStyle}>
              Optional. Snapshotted onto each billable round, so changing it
              later never re-prices a month already released.
            </p>
          </div>

          {error && (
            <div role="alert" style={errorStyle}>
              {error}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={cancelStyle}
          >
            Cancel
          </button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : cycle ? "Save changes" : "Create cycle"}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}

const readOnlyStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  color: "var(--text-primary)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 12,
  marginTop: 24,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const cancelStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  minHeight: 44,
  padding: "0 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-body)",
  cursor: "pointer",
};
