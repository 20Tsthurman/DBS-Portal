"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { addTimeLogAction } from "@/app/owner/clients/_actions";
import type { TimeLogCategory } from "@/lib/supabase";

interface ClientOption {
  id: string;
  name: string;
}

interface QuickLogFormProps {
  /** Pre-fetched client list (server-side). */
  clients: ClientOption[];
  /** Today's date in PORTAL_TIMEZONE as YYYY-MM-DD. */
  todayKey: string;
}

const CATEGORIES: { value: TimeLogCategory; label: string }[] = [
  { value: "editing", label: "Editing" },
  { value: "planning", label: "Planning" },
  { value: "filming", label: "Filming" },
  { value: "admin", label: "Admin" },
  { value: "communication", label: "Communication" },
];

const SUCCESS_FADE_MS = 4000;

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
  marginBottom: 6,
  fontWeight: 600,
};

// Local copy of the shared formStyles.fieldStyle. 16px suppresses iOS Safari's
// auto-zoom on focus; minHeight gives a 48px touch target.
const fieldStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  background: "#FFFFFF",
  padding: "8px 12px",
  fontSize: 16,
  minHeight: 48,
  color: "var(--text-primary)",
  fontFamily: "inherit",
  outline: "none",
};

function applyFocus(
  e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>
) {
  e.currentTarget.style.borderColor = "var(--accent)";
}

function clearFocus(
  e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>
) {
  e.currentTarget.style.borderColor = "var(--border)";
}

function formatHoursForMessage(hours: number): string {
  if (Number.isInteger(hours)) return String(hours);
  return hours.toString();
}

export function QuickLogForm({ clients, todayKey }: QuickLogFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clientId, setClientId] = useState<string>("");
  const [date, setDate] = useState<string>(todayKey);
  const [hours, setHours] = useState<string>("");
  const [category, setCategory] = useState<TimeLogCategory>("editing");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending success-fade timer on unmount.
  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.id, c.name);
    return map;
  }, [clients]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (success) {
      // New submit cancels any in-progress fade.
      if (successTimer.current) clearTimeout(successTimer.current);
      setSuccess(null);
    }

    const parsedHours = Number(hours);
    if (
      !clientId ||
      !date ||
      !category ||
      !Number.isFinite(parsedHours) ||
      parsedHours < 0.5
    ) {
      setError("Please complete all required fields.");
      return;
    }

    // Snapshot name for the success message — addTimeLogAction returns the
    // inserted row but not the joined client name, so we use the picker's
    // value (which is by definition correct here).
    const snapshotClientName =
      clientNameById.get(clientId) ?? "selected client";
    const snapshotHours = parsedHours;

    startTransition(async () => {
      const result = await addTimeLogAction({
        clientId,
        date,
        hours: parsedHours,
        category,
        notes,
      });
      if (!result.ok) {
        console.error("[QuickLogForm] addTimeLogAction failed", result.error);
        setError(result.error ?? "Failed to log time.");
        return;
      }

      setHours("");
      setNotes("");
      setSuccess(
        `Logged ${formatHoursForMessage(snapshotHours)} hrs for ${snapshotClientName}.`
      );
      if (successTimer.current) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => {
        setSuccess(null);
        successTimer.current = null;
      }, SUCCESS_FADE_MS);

      // Re-render the server components below (week + month sections).
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="quick-log-form">
      <div className="quick-log-row">
        <div className="quick-log-field quick-log-field--client">
          <label htmlFor="quick-log-client" style={labelStyle}>
            Client
          </label>
          <select
            id="quick-log-client"
            required
            disabled={isPending}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
          >
            <option value="">Select a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="quick-log-field quick-log-field--date">
          <label htmlFor="quick-log-date" style={labelStyle}>
            Date
          </label>
          <input
            id="quick-log-date"
            type="date"
            required
            disabled={isPending}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
          />
        </div>
        <div className="quick-log-field quick-log-field--hours">
          <label htmlFor="quick-log-hours" style={labelStyle}>
            Hours
          </label>
          <input
            id="quick-log-hours"
            type="number"
            required
            min="0.5"
            step="0.5"
            disabled={isPending}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
          />
        </div>
        <div className="quick-log-field quick-log-field--category">
          <label htmlFor="quick-log-category" style={labelStyle}>
            Category
          </label>
          <select
            id="quick-log-category"
            required
            disabled={isPending}
            value={category}
            onChange={(e) => setCategory(e.target.value as TimeLogCategory)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="quick-log-field quick-log-field--notes">
          <label htmlFor="quick-log-notes" style={labelStyle}>
            Notes
          </label>
          <input
            id="quick-log-notes"
            type="text"
            disabled={isPending}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
            placeholder="Optional"
          />
        </div>
        <div className="quick-log-field quick-log-field--submit">
          <button
            type="submit"
            disabled={isPending}
            style={{
              backgroundColor: "var(--accent)",
              color: "#FFFFFF",
              border: "none",
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.6 : 1,
              height: 38,
              whiteSpace: "nowrap",
            }}
          >
            {isPending ? "Logging…" : "Log entry"}
          </button>
        </div>
      </div>

      {error && (
        <p
          style={{
            marginTop: 12,
            color: "var(--status-danger)",
            fontSize: 13,
          }}
          role="alert"
        >
          {error}
        </p>
      )}
      {success && !error && (
        <p
          style={{
            marginTop: 12,
            color: "var(--text-body)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
            transition: "opacity 300ms ease",
          }}
          role="status"
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              backgroundColor: "var(--status-success)",
            }}
          />
          {success}
        </p>
      )}

      <style>{`
        .quick-log-form { width: 100%; }
        .quick-log-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: flex-end;
        }
        .quick-log-field { flex: 0 0 auto; }
        .quick-log-field--client { width: 240px; }
        .quick-log-field--date { width: 160px; }
        .quick-log-field--hours { width: 100px; }
        .quick-log-field--category { width: 160px; }
        .quick-log-field--notes { flex: 1 1 200px; min-width: 160px; }
        .quick-log-field--submit { display: flex; align-items: flex-end; }
        @media (max-width: 800px) {
          .quick-log-field,
          .quick-log-field--client,
          .quick-log-field--date,
          .quick-log-field--hours,
          .quick-log-field--category,
          .quick-log-field--notes,
          .quick-log-field--submit {
            width: 100%;
            flex: 1 1 100%;
          }
        }
      `}</style>
    </form>
  );
}
