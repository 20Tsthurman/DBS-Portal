"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { formatMessageTimestamp } from "@/lib/formatRelativeTime";
import type { GoogleCalendarStatus } from "../_lib/types";
import { disconnectGoogleCalendarAction } from "../_actions";

interface GoogleCalendarSectionProps {
  initial: GoogleCalendarStatus;
  /** Outcome flag from the OAuth callback redirect (?google=…), or null. */
  notice: string | null;
}

/**
 * Google Calendar connection card (Stage 1: read-only import).
 *
 * Connect is a plain navigation — /api/google/connect must set the CSRF
 * state cookie and redirect to Google's consent screen, which a server
 * action can't do. Disconnect goes through a server action (revoke + clear).
 */
export function GoogleCalendarSection({
  initial,
  notice,
}: GoogleCalendarSectionProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

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
              {initial.calendarId && initial.calendarId !== "primary"
                ? ` — ${initial.calendarId}`
                : " — primary calendar"}
            </p>
            <p style={helperStyle}>
              {initial.lastSyncedAt
                ? `Last synced ${formatMessageTimestamp(initial.lastSyncedAt)}.`
                : "Not synced yet — opening the calendar will trigger the first sync."}{" "}
              Google events appear read-only on your calendar and block client
              booking requests. Syncs run when you open the calendar and once
              daily.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
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
