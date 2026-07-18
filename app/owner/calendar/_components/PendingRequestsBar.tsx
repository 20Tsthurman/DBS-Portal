import Link from "next/link";
import type { CSSProperties } from "react";
import type { PendingShoot } from "../_lib/queries";
import {
  formatTimeInTimezone,
  shortDateLabelForDateKey,
  shortWeekdayForDateKey,
} from "../_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { PendingRequestActions } from "./PendingRequestActions";

interface PendingRequestsBarProps {
  shoots: PendingShoot[];
  /** Link to open the full edit panel for a given shoot. */
  editHrefFor: (shootId: string) => string;
}

export function PendingRequestsBar({
  shoots,
  editHrefFor,
}: PendingRequestsBarProps) {
  if (shoots.length === 0) return null;

  return (
    <section style={cardStyle}>
      <header style={headerStyle}>
        <p style={eyebrowStyle}>
          {shoots.length} pending request{shoots.length === 1 ? "" : "s"}
        </p>
        <p style={sublineStyle}>
          {shoots.length === 1
            ? "A client is waiting on your confirmation."
            : "Clients are waiting on your confirmation."}
        </p>
      </header>

      <ul style={listStyle}>
        {shoots.map((s, i) => (
          <PendingRow
            key={s.id}
            shoot={s}
            isLast={i === shoots.length - 1}
            editHref={editHrefFor(s.id)}
          />
        ))}
      </ul>
    </section>
  );
}

interface PendingRowProps {
  shoot: PendingShoot;
  isLast: boolean;
  editHref: string;
}

function PendingRow({ shoot, isLast, editHref }: PendingRowProps) {
  const startsAt = new Date(shoot.scheduled_at);
  const endsAt = new Date(
    startsAt.getTime() + (shoot.duration_hours ?? 1) * 3600 * 1000
  );
  const dk = dateKeyInTimezone(startsAt);
  const dayLabel = `${shortWeekdayForDateKey(dk)}, ${shortDateLabelForDateKey(dk)}`;
  const timeRange = `${formatTimeInTimezone(startsAt)} – ${formatTimeInTimezone(endsAt)}`;
  const whenLabel = `${dayLabel} · ${formatTimeInTimezone(startsAt)}`;
  const location = shoot.location?.trim() || null;

  return (
    <li
      style={{
        ...rowStyle,
        borderBottom: isLast ? undefined : "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <Link href={editHref} style={clientNameLinkStyle}>
          {shoot.client_name}
        </Link>
        <p style={metaLineStyle}>
          {dayLabel} · {timeRange}
          {location && (
            <>
              <span style={dotStyle}>·</span>
              {location}
            </>
          )}
        </p>
      </div>
      <PendingRequestActions
        shootId={shoot.id}
        clientName={shoot.client_name}
        whenLabel={whenLabel}
        size="sm"
      />
    </li>
  );
}

const cardStyle: CSSProperties = {
  marginBottom: 24,
  border: "1px solid var(--border)",
  borderTop: "3px solid var(--accent)",
  backgroundColor: "rgba(168, 120, 138, 0.06)",
};

const headerStyle: CSSProperties = {
  padding: "14px 20px",
  borderBottom: "1px solid var(--border)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--accent)",
  fontWeight: 700,
  margin: 0,
};

const sublineStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--text-body)",
  margin: 0,
  marginTop: 4,
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "12px 20px",
  flexWrap: "wrap",
};

const clientNameLinkStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  textDecoration: "none",
};

const metaLineStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--text-body)",
  margin: 0,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 6,
};

const dotStyle: CSSProperties = {
  color: "var(--text-muted)",
};
