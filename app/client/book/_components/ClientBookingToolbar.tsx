import Link from "next/link";
import type { CSSProperties } from "react";
import {
  addMonthsToMonthKey,
  currentMonthKey,
  formatMonthLabel,
} from "@/app/owner/calendar/_lib/timezone";

interface ClientBookingToolbarProps {
  monthKey: string;
}

export function ClientBookingToolbar({ monthKey }: ClientBookingToolbarProps) {
  const prevKey = addMonthsToMonthKey(monthKey, -1);
  const nextKey = addMonthsToMonthKey(monthKey, 1);
  const todayMonth = currentMonthKey();
  const label = formatMonthLabel(monthKey);

  const monthHref = (k: string) => `/client/book?month=${k}`;
  // The panel doesn't exist yet (Phase 5c) — link forward to the same URL
  // contract Phase 5c will read, but the page currently treats it as a no-op.
  const requestHref = `/client/book?month=${monthKey}&request=1`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 24,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href={monthHref(todayMonth)} style={pillButton}>
          Today
        </Link>
        <Link
          href={monthHref(prevKey)}
          aria-label="Previous month"
          style={iconButton}
        >
          ◀
        </Link>
        <Link
          href={monthHref(nextKey)}
          aria-label="Next month"
          style={iconButton}
        >
          ▶
        </Link>
        <h2
          style={{
            marginLeft: 12,
            fontFamily: "var(--font-playfair), serif",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          {label}
        </h2>
      </div>

      <Link href={requestHref} style={addButton}>
        + Request a Shoot
      </Link>
    </div>
  );
}

const pillButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 36,
  padding: "0 14px",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "var(--surface-raised)",
};

const iconButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 14,
  lineHeight: 1,
  backgroundColor: "var(--surface-raised)",
};

const addButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 36,
  padding: "0 18px",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
  backgroundColor: "var(--accent)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
  cursor: "pointer",
};
