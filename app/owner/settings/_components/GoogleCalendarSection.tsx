"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { formatMessageTimestamp } from "@/lib/formatRelativeTime";
import type { GoogleCalendarChoices, GoogleCalendarStatus } from "../_lib/types";
import {
  disconnectGoogleCalendarAction,
  updateSyncedCalendarsAction,
} from "../_actions";

interface GoogleCalendarSectionProps {
  initial: GoogleCalendarStatus;
  /** Calendar-picker rows (live Google list merged with the stored selection). */
  calendars: GoogleCalendarChoices;
  /** Outcome flag from the OAuth callback redirect (?google=…), or null. */
  notice: string | null;
}

/**
 * Google Calendar connection card (Stage 1: read-only import).
 *
 * Connect is a plain navigation — /api/google/connect must set the CSRF
 * state cookie and redirect to Google's consent screen, which a server
 * action can't do. Disconnect and the calendar selection go through server
 * actions.
 */
export function GoogleCalendarSection({
  initial,
  calendars,
  notice,
}: GoogleCalendarSectionProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(calendars.choices.filter((c) => c.selected).map((c) => c.id))
  );
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isSaving, startSaving] = useTransition();

  const initialSelected = new Set(
    calendars.choices.filter((c) => c.selected).map((c) => c.id)
  );
  const dirty =
    selectedIds.size !== initialSelected.size ||
    [...selectedIds].some((id) => !initialSelected.has(id));

  const toggleCalendar = (id: string) => {
    setSavedAt(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveCalendars = () => {
    setError(null);
    startSaving(async () => {
      const res = await updateSyncedCalendarsAction([...selectedIds]);
      if (!res.ok) {
        setError(res.error ?? "Failed to update calendars.");
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  };

  const handleDisconnect = () => {
    setError(null);
    startTransition(async () => {
      const res = await disconnectGoogleCalendarAction();
      if (!res.ok) {
        setError(res.error ?? "Failed to disconnect.");
        setConfirmOpen(false);
        return;
      }
      setConfirmOpen(false);
      // Server action revalidated /owner/settings; refresh pulls the new
      // connection state (and drops the ?google= flag from a prior connect).
      router.replace("/owner/settings");
      router.refresh();
    });
  };

  const noticeText = noticeMessage(notice);

  return (
    <DashboardCard eyebrow="INTEGRATIONS" title="Google Calendar">
      <div style={{ maxWidth: 560 }}>
        {noticeText && (
          <p
            role="status"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              fontSize: 13,
              lineHeight: 1.5,
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${
                noticeText.tone === "success"
                  ? "var(--status-success)"
                  : "var(--status-danger)"
              }`,
              color: "var(--text-body)",
              backgroundColor: "var(--surface-base)",
            }}
          >
            {noticeText.message}
          </p>
        )}

        {initial.connected ? (
          <>
            <p style={statusLineStyle}>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "var(--status-success)",
                  marginRight: 8,
                }}
              />
              Connected
            </p>
            <p style={helperStyle}>
              {initial.lastSyncedAt
                ? `Last synced ${formatMessageTimestamp(initial.lastSyncedAt)}.`
                : "Not synced yet — opening the calendar will trigger the first sync."}{" "}
              Events from the checked calendars appear read-only on your
              calendar and block client booking requests. Syncs run when you
              open the calendar and once daily.
            </p>

            <div style={{ marginBottom: 16 }}>
              <p style={pickerLabelStyle}>Calendars to sync</p>
              {calendars.choices.length === 0 ? (
                <p style={helperStyle}>
                  No calendars found on the connected account.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    border: "1px solid var(--border)",
                    padding: "10px 12px",
                  }}
                >
                  {calendars.choices.map((c) => (
                    <label
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontSize: 13,
                        color: "var(--text-body)",
                        cursor:
                          calendars.live && !isSaving ? "pointer" : "default",
                      }}
                    >
                      <input
                        type="checkbox"
                        className="st-active-checkbox"
                        checked={selectedIds.has(c.id)}
                        disabled={!calendars.live || isSaving}
                        onChange={() => toggleCalendar(c.id)}
                      />
                      <span
                        aria-hidden="true"
                        style={{
                          display: "inline-block",
                          width: 12,
                          height: 12,
                          flexShrink: 0,
                          backgroundColor: c.color ?? "var(--border)",
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.name}
                        {c.primary && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 11,
                              color: "var(--text-muted)",
                            }}
                          >
                            (primary)
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {!calendars.live && (
                <p style={{ ...helperStyle, marginTop: 8, marginBottom: 0 }}>
                  Couldn&apos;t reach Google to load the full calendar list —
                  showing only the currently synced calendars. Reload to try
                  again.
                </p>
              )}
              {calendars.live && (
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <Button
                    type="button"
                    disabled={!dirty || isSaving}
                    onClick={handleSaveCalendars}
                  >
                    {isSaving ? "Syncing…" : "Save calendars"}
                  </Button>
                  {savedAt !== null && !isSaving && !dirty && (
                    <span
                      role="status"
                      aria-live="polite"
                      style={{
                        fontSize: 12,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--status-success)",
                        fontWeight: 600,
                      }}
                    >
                      Saved.
                    </span>
                  )}
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="secondary"
              disabled={isPending || isSaving}
              onClick={() => setConfirmOpen(true)}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <p style={helperStyle}>
              Connect your personal Google Calendar to see its events on the
              portal calendar and prevent clients from booking over them.
              Stage 1 is read-only — nothing is ever written to Google.
            </p>
            <a href="/api/google/connect" style={connectLinkStyle}>
              Connect Google Calendar
            </a>
          </>
        )}

        {error && (
          <p
            role="alert"
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--status-danger)",
            }}
          >
            {error}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Google Calendar?"
        body="The imported Google events will be removed from the portal calendar and will stop blocking client bookings. Your Google Calendar itself is not affected. You can reconnect at any time."
        confirmLabel="Disconnect"
        variant="danger"
        busy={isPending}
      />
    </DashboardCard>
  );
}

function noticeMessage(
  notice: string | null
): { message: string; tone: "success" | "danger" } | null {
  switch (notice) {
    case "connected":
      return {
        message: "Google Calendar connected. Events are importing now.",
        tone: "success",
      };
    case "denied":
      return {
        message: "Google access was declined, so nothing was connected.",
        tone: "danger",
      };
    case "state_mismatch":
      return {
        message:
          "The sign-in attempt could not be verified (it may have expired). Please try connecting again.",
        tone: "danger",
      };
    case "error":
      return {
        message: "Something went wrong while connecting. Please try again.",
        tone: "danger",
      };
    default:
      return null;
  }
}

const statusLineStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  marginBottom: 8,
};

const helperStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  lineHeight: 1.5,
  marginBottom: 16,
};

const pickerLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 8,
};

const connectLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  textDecoration: "none",
};
