"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type {
  ClientRecord,
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
import { createShoot, updateShoot } from "../_actions";

interface ShootFormPanelProps {
  open: boolean;
  onClose: () => void;
  clients: Pick<ClientRecord, "id" | "name">[];
  shoot?: ShootRecord;
  /** ISO timestamp used to prefill the date field in create mode. Ignored when `shoot` is provided. */
  defaultScheduledAt?: string;
}

interface FormValues {
  clientId: string;
  scheduledAt: string;
  location: string;
  durationHours: string;
  status: ShootStatus;
  notes: string;
}

const emptyValues: FormValues = {
  clientId: "",
  scheduledAt: "",
  location: "",
  durationHours: "",
  status: "confirmed",
  notes: "",
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
  };
}

export function ShootFormPanel({
  open,
  onClose,
  clients,
  shoot,
  defaultScheduledAt,
}: ShootFormPanelProps) {
  const router = useRouter();
  const isEdit = Boolean(shoot);
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      if (shoot) {
        setValues(valuesFromShoot(shoot));
      } else if (defaultScheduledAt) {
        setValues({
          ...emptyValues,
          scheduledAt: isoToLocalDateTime(defaultScheduledAt),
        });
      } else {
        setValues(emptyValues);
      }
      setError(null);
    }
  }, [open, shoot, defaultScheduledAt]);

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

    const payload = {
      clientId: values.clientId,
      scheduledAt: localDate.toISOString(),
      location: values.location.trim() || null,
      durationHours,
      notes: values.notes.trim() || null,
      status: values.status,
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

  const title = isEdit ? "Edit Shoot" : "Add Shoot";
  const submitIdle = isEdit ? "Save Changes" : "Save Shoot";

  return (
    <SlidePanel open={open} onClose={onClose} title={title}>
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          <div>
            <label htmlFor="shoot-client" style={labelStyle}>
              Client
            </label>
            <select
              id="shoot-client"
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
            <label htmlFor="shoot-when" style={labelStyle}>
              Date &amp; Time
            </label>
            <input
              id="shoot-when"
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

          <div>
            <label htmlFor="shoot-location" style={labelStyle}>
              Location
            </label>
            <input
              id="shoot-location"
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
            <label htmlFor="shoot-duration" style={labelStyle}>
              Duration (hours)
            </label>
            <input
              id="shoot-duration"
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
            <label htmlFor="shoot-status" style={labelStyle}>
              Status
            </label>
            <select
              id="shoot-status"
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
            <label htmlFor="shoot-notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="shoot-notes"
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
