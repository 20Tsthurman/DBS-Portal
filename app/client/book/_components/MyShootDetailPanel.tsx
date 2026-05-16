import Link from "next/link";
import type { CSSProperties } from "react";
import type { ShootRecord } from "@/lib/supabase";
import {
  dateKeyInTimezone,
  formatTimeInTimezone,
  fullDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { StatusBadge } from "./StatusBadge";
import { CancelRequestButton } from "./CancelRequestButton";

interface MyShootDetailPanelProps {
  shoot: ShootRecord;
  closeHref: string;
}

const PANEL_WIDTH = 320;

export function MyShootDetailPanel({
  shoot,
  closeHref,
}: MyShootDetailPanelProps) {
  const startsAt = new Date(shoot.scheduled_at);
  const durationHours = shoot.duration_hours ?? 1;
  const endsAt = new Date(startsAt.getTime() + durationHours * 3600 * 1000);
  const dateLabel = fullDateLabelForDateKey(dateKeyInTimezone(startsAt));
  const timeLabel = `${formatTimeInTimezone(startsAt)} – ${formatTimeInTimezone(endsAt)}`;
  const durationLabel = formatDuration(durationHours);

  return (
    <>
      <Link
        href={closeHref}
        aria-label="Close shoot panel"
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.2)",
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label="Your shoot"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          maxWidth: "100%",
          backgroundColor: "var(--surface-raised)",
          borderLeft: "1px solid var(--border)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            gap: 12,
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: 18,
              fontWeight: 500,
              color: "var(--text-primary)",
              letterSpacing: "-0.01em",
            }}
          >
            Your shoot
          </h2>
          <Link href={closeHref} aria-label="Close" style={iconCloseStyle}>
            ×
          </Link>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div>
            <StatusBadge status={shoot.status} />
          </div>
          <Field label="Date" value={dateLabel} />
          <Field label="Time" value={timeLabel} />
          <Field label="Duration" value={durationLabel} />
          <Field label="Location" value={shoot.location?.trim() || null} />
          <Field
            label="Notes"
            value={shoot.notes?.trim() || null}
            multiline
          />
        </div>

        <footer
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          {shoot.status === "requested" ? (
            <CancelRequestButton
              shootId={shoot.id}
              closeHref={closeHref}
            />
          ) : (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                fontStyle: "italic",
                margin: 0,
              }}
            >
              Need to make a change? Send Kelsey a message.
            </p>
          )}
        </footer>
      </aside>
    </>
  );
}

interface FieldProps {
  label: string;
  value: string | null;
  multiline?: boolean;
}

function Field({ label, value, multiline = false }: FieldProps) {
  return (
    <div>
      <p
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </p>
      {value ? (
        <p
          style={{
            fontSize: 14,
            color: "var(--text-primary)",
            whiteSpace: multiline ? "pre-wrap" : undefined,
            margin: 0,
          }}
        >
          {value}
        </p>
      ) : (
        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            margin: 0,
          }}
        >
          —
        </p>
      )}
    </div>
  );
}

function formatDuration(hours: number): string {
  if (hours === 0.5) return "30 minutes";
  if (hours === 1) return "1 hour";
  // Drop trailing ".0" for whole numbers, keep ".5" for halves.
  const text = Number.isInteger(hours) ? `${hours}` : `${hours}`;
  return `${text} hours`;
}

const iconCloseStyle: CSSProperties = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-body)",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  fontSize: 18,
  lineHeight: 1,
  textDecoration: "none",
};
