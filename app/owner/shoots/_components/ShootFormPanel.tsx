"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type {
  ClientRecord,
  MeetingType,
  ShootKind,
  ShootRecord,
  ShootStatus,
} from "@/lib/supabase";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import { PendingRequestActions } from "@/app/owner/calendar/_components/PendingRequestActions";
import { createShoot, updateShoot } from "../_actions";

interface ShootFormPanelProps {
  open: boolean;
  onClose: () => void;
  clients: Pick<ClientRecord, "id" | "name">[];
  shoot?: ShootRecord;
  /** ISO timestamp used to prefill the date field in create mode. Ignored when `shoot` is provided. */
  defaultScheduledAt?: string;
  /** Initial kind in create mode (e.g. when DayPanel's "+ Add meeting" path is wired up). Defaults to "shoot". Ignored when `shoot` is provided. */
  defaultKind?: ShootKind;
}

interface FormValues {
  clientId: string;
  scheduledAt: string;
  location: string;
  durationHours: string;
  status: ShootStatus;
  notes: string;
  kind: ShootKind;
  // Stored as "" when kind === "shoot"; required to be one of the
  // MeetingType values when kind === "meeting".
  meetingType: MeetingType | "";
}

const emptyValues: FormValues = {
  clientId: "",
  scheduledAt: "",
  location: "",
  durationHours: "",
  status: "confirmed",
  notes: "",
  kind: "shoot",
  meetingType: "",
};

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Inverse of `new Date(localValue).toISOString()` — formats a stored UTC ISO
// back into the local YYYY-MM-DDTHH:mm shape that <input type=datetime-local> wants.
function isoToLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function valuesFromShoot(shoot: ShootRecord): FormValues {
  return {
    clientId: shoot.client_id,
    scheduledAt: isoToLocalDateTime(shoot.scheduled_at),
    location: shoot.location ?? "",
    durationHours:
      shoot.duration_hours !== null ? String(shoot.duration_hours) : "",
    status: shoot.status,
    notes: shoot.notes ?? "",
    kind: shoot.kind,
    meetingType: shoot.meeting_type ?? "",
  };
}

export function ShootFormPanel({
  open,
  onClose,
  clients,
  shoot,
  defaultScheduledAt,
  defaultKind,
}: ShootFormPanelProps) {
  const router = useRouter();
  const isEdit = Boolean(shoot);
  // Every list row mounts its own ShootFormPanel (SlidePanel keeps the DOM
  // mounted while closed), so static ids would collide and label htmlFor
  // would resolve to the wrong panel's input — most visibly, the Kind radio
  // toggle would refuse to flip. useId scopes ids to this instance.
  const fieldId = useId();
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (shoot) {
        setValues(valuesFromShoot(shoot));
      } else {
        setValues({
          ...emptyValues,
          scheduledAt: defaultScheduledAt
            ? isoToLocalDateTime(defaultScheduledAt)
            : "",
          kind: defaultKind ?? "shoot",
        });
      }
      setError(null);
    }
  }, [open, shoot, defaultScheduledAt, defaultKind]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!values.clientId) {
      setError("Please select a client.");
      return;
    }
    if (!values.scheduledAt) {
      setError("Date & time are required.");
      return;
    }
    const localDate = new Date(values.scheduledAt);
    if (Number.isNaN(localDate.getTime())) {
      setError("Date & time must be valid.");
      return;
    }

    let durationHours: number | null = null;
    if (values.durationHours.trim().length > 0) {
      const n = Number(values.durationHours);
      if (!Number.isFinite(n) || n < 0) {
        setError("Duration must be a non-negative number.");
        return;
      }
      durationHours = n;
    }

    if (values.kind === "meeting" && values.meetingType === "") {
      setError("Pick a meeting type (Zoom, phone, or in-person).");
      return;
    }

    const payload = {
      clientId: values.clientId,
      scheduledAt: localDate.toISOString(),
      // Phone meetings have no location; the field is hidden in the UI but
      // we also strip any stale value here in case `location` was filled
      // before the user switched kind.
      location:
        values.kind === "meeting" && values.meetingType === "phone"
          ? null
          : values.location.trim() || null,
      durationHours,
      notes: values.notes.trim() || null,
      status: values.status,
      kind: values.kind,
      meetingType:
        values.kind === "meeting"
          ? (values.meetingType as MeetingType)
          : null,
    };

    setSubmitting(true);
    try {
      const result = shoot
        ? await updateShoot(shoot.id, payload)
        : await createShoot(payload);
      if (!result.ok) {
        setError(result.error ?? "Failed to save shoot.");
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

  const isMeeting = values.kind === "meeting";
  const title = isEdit
    ? isMeeting
      ? "Edit Meeting"
      : "Edit Shoot"
    : isMeeting
      ? "Schedule Meeting"
      : "Add Shoot";
  const submitIdle = isEdit
    ? "Save Changes"
    : isMeeting
      ? "Schedule Meeting"
      : "Save Shoot";

  // Location field adapts to the meeting type:
  //   shoot               → "Location" (e.g. "Franklin, TN")
  //   meeting + in_person → "Location" (e.g. "client's home")
  //   meeting + zoom      → "Meeting link" (free-text; Zoom link goes here)
  //   meeting + phone     → hidden entirely (no location for a phone call)
  let locationLabel = "Location";
  let showLocation = true;
  if (isMeeting) {
    if (values.meetingType === "zoom") locationLabel = "Meeting link";
    else if (values.meetingType === "phone") showLocation = false;
  }

  const isPendingRequest = shoot?.status === "requested";
  const pendingClientName =
    (shoot && clients.find((c) => c.id === shoot.client_id)?.name) ?? "This client";
  const pendingWhenLabel =
    shoot && values.scheduledAt
      ? new Date(shoot.scheduled_at).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";

  return (
    <SlidePanel open={open} onClose={onClose} title={title}>
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          {isPendingRequest && shoot && (
            <div
              style={{
                padding: "14px 16px",
                border: "1px solid var(--accent)",
                borderTop: "3px solid var(--accent)",
                backgroundColor: "rgba(168, 120, 138, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--accent)",
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  Pending your review
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-body)",
                    margin: 0,
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {pendingClientName} requested this shoot. Confirm to accept
                  it, or decline to cancel. Use the form below first if the
                  details need adjusting.
                </p>
              </div>
              <PendingRequestActions
                shootId={shoot.id}
                clientName={pendingClientName}
                whenLabel={pendingWhenLabel}
                size="md"
                onSuccess={onClose}
              />
            </div>
          )}

          <div>
            <span style={labelStyle}>Kind</span>
            <div
              role="radiogroup"
              aria-label="Kind"
              style={{
                display: "flex",
                gap: 8,
                marginTop: 4,
              }}
            >
              <KindOption
                idPrefix={fieldId}
                value="shoot"
                label="Shoot"
                checked={values.kind === "shoot"}
                onSelect={() =>
                  setValues((v) => ({
                    ...v,
                    kind: "shoot",
                    // Clear meeting-only fields when switching back to a shoot.
                    meetingType: "",
                  }))
                }
              />
              <KindOption
                idPrefix={fieldId}
                value="meeting"
                label="Meeting"
                checked={values.kind === "meeting"}
                onSelect={() =>
                  setValues((v) => ({
                    ...v,
                    kind: "meeting",
                  }))
                }
              />
            </div>
          </div>

          {isMeeting && (
            <div>
              <label htmlFor={`${fieldId}-meeting-type`} style={labelStyle}>
                Meeting type
              </label>
              <select
                id={`${fieldId}-meeting-type`}
                required
                value={values.meetingType}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    meetingType: e.target.value as MeetingType | "",
                  }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={fieldStyle}
              >
                <option value="">Select a type…</option>
                <option value="zoom">Zoom</option>
                <option value="phone">Phone call</option>
                <option value="in_person">In-person</option>
              </select>
            </div>
          )}

          <div>
            <label htmlFor={`${fieldId}-client`} style={labelStyle}>
              Client
            </label>
            <select
              id={`${fieldId}-client`}
              required
              value={values.clientId}
              onChange={(e) =>
                setValues((v) => ({ ...v, clientId: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${fieldId}-when`} style={labelStyle}>
              Date &amp; Time
            </label>
            <input
              id={`${fieldId}-when`}
              type="datetime-local"
              required
              value={values.scheduledAt}
              onChange={(e) =>
                setValues((v) => ({ ...v, scheduledAt: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          {showLocation && (
            <div>
              <label htmlFor={`${fieldId}-location`} style={labelStyle}>
                {locationLabel}
              </label>
              <input
                id={`${fieldId}-location`}
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
          )}

          <div>
            <label htmlFor={`${fieldId}-duration`} style={labelStyle}>
              Duration (hours)
            </label>
            <input
              id={`${fieldId}-duration`}
              type="number"
              step="0.5"
              min={0}
              value={values.durationHours}
              onChange={(e) =>
                setValues((v) => ({ ...v, durationHours: e.target.value }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-status`} style={labelStyle}>
              Status
            </label>
            <select
              id={`${fieldId}-status`}
              value={values.status}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  status: e.target.value as ShootStatus,
                }))
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              <option value="confirmed">Confirmed</option>
              <option value="requested">Requested</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${fieldId}-notes`} style={labelStyle}>
              Notes
            </label>
            <textarea
              id={`${fieldId}-notes`}
              rows={4}
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
            {submitting ? "Saving…" : submitIdle}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}

interface KindOptionProps {
  idPrefix: string;
  value: ShootKind;
  label: string;
  checked: boolean;
  onSelect: () => void;
}

function KindOption({ idPrefix, value, label, checked, onSelect }: KindOptionProps) {
  return (
    <label
      htmlFor={`${idPrefix}-kind-${value}`}
      style={{
        flex: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 12px",
        border: checked
          ? "1px solid var(--accent)"
          : "1px solid var(--border)",
        backgroundColor: checked
          ? "rgba(168, 120, 138, 0.10)"
          : "transparent",
        color: checked ? "var(--text-primary)" : "var(--text-body)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <input
        id={`${idPrefix}-kind-${value}`}
        type="radio"
        name={`${idPrefix}-kind`}
        value={value}
        checked={checked}
        onChange={onSelect}
        style={{
          // Hide the native control — the surrounding label is the affordance.
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
      {label}
    </label>
  );
}
