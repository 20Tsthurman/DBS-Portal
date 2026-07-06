"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import {
  dateKeyInTimezone,
  formatTimeInTimezone,
  fullDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import type { PendingCandidate } from "../_lib/queries";
import {
  confirmShootCandidateAction,
  dismissShootCandidateAction,
} from "../_actions";

interface CandidateListProps {
  candidates: PendingCandidate[];
  clients: Array<{ id: string; name: string }>;
}

export function CandidateList({ candidates, clients }: CandidateListProps) {
  if (candidates.length === 0) {
    return (
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          fontStyle: "italic",
        }}
      >
        Nothing to confirm. Google events titled with &ldquo;Shoot&rdquo; or
        &ldquo;Content&rdquo; will show up here.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {candidates.map((c) => (
        <CandidateCard key={c.id} candidate={c} clients={clients} />
      ))}
    </div>
  );
}

function CandidateCard({
  candidate,
  clients,
}: {
  candidate: PendingCandidate;
  clients: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [location, setLocation] = useState(candidate.location ?? "");
  const [startTime, setStartTime] = useState("09:00");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startsAt = new Date(candidate.startsAt);
  const endsAt = new Date(candidate.endsAt);
  const dateLabel = fullDateLabelForDateKey(dateKeyInTimezone(startsAt));
  const timeLabel = candidate.allDay
    ? "All day"
    : `${formatTimeInTimezone(startsAt)} – ${formatTimeInTimezone(endsAt)}`;

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await confirmShootCandidateAction({
        externalEventId: candidate.id,
        clientId,
        location: location.trim() || null,
        startTime: candidate.allDay ? startTime : undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed to confirm.");
        return;
      }
      router.refresh();
    });
  };

  const handleDismiss = () => {
    setError(null);
    startTransition(async () => {
      const res = await dismissShootCandidateAction(candidate.id);
      if (!res.ok) {
        setError(res.error ?? "Failed to dismiss.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 12 }}>
        <p
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          {candidate.calendarName}
        </p>
        <h2
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: 18,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          {candidate.title}
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-body)", marginTop: 2 }}>
          {dateLabel} · {timeLabel}
          {candidate.htmlLink && (
            <>
              {" · "}
              <a
                href={candidate.htmlLink}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--text-muted)",
                  textDecoration: "underline",
                }}
              >
                View in Google Calendar ↗
              </a>
            </>
          )}
        </p>
      </div>

      <div style={fieldsRowStyle}>
        <div style={{ flex: "1 1 200px", minWidth: 180 }}>
          <label htmlFor={`client-${candidate.id}`} style={labelStyle}>
            Client (required)
          </label>
          <select
            id={`client-${candidate.id}`}
            value={clientId}
            disabled={isPending}
            onChange={(e) => setClientId(e.target.value)}
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

        <div style={{ flex: "2 1 260px", minWidth: 200 }}>
          <label htmlFor={`location-${candidate.id}`} style={labelStyle}>
            Location
          </label>
          <input
            id={`location-${candidate.id}`}
            type="text"
            value={location}
            disabled={isPending}
            onChange={(e) => setLocation(e.target.value)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            style={fieldStyle}
            placeholder="Address (used for mileage)"
          />
        </div>

        {candidate.allDay && (
          <div style={{ flex: "0 1 130px", minWidth: 110 }}>
            <label htmlFor={`time-${candidate.id}`} style={labelStyle}>
              Start time
            </label>
            <input
              id={`time-${candidate.id}`}
              type="time"
              value={startTime}
              disabled={isPending}
              onChange={(e) => setStartTime(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Button
          type="button"
          disabled={isPending || !clientId}
          onClick={handleConfirm}
        >
          {isPending ? "Working…" : "Confirm shoot"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={handleDismiss}
        >
          Not a shoot
        </Button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  backgroundColor: "var(--surface-raised)",
  padding: "16px 20px",
};

const fieldsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};
