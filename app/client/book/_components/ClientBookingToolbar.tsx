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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <Link
        href={monthHref(prevKey)}
        aria-label="Previous month"
        style={iconButton}
      >
        ◀
      </Link>
      <Link href={monthHref(todayMonth)} style={todayPill}>
        Today
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
          marginLeft: 8,
          fontFamily: "var(--font-playfair), serif",
          fontSize: 18,
          fontWeight: 500,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </h2>
    </div>
  );
}

const iconButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 12,
  lineHeight: 1,
  backgroundColor: "var(--surface-raised)",
};

const todayPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "transparent",
};
