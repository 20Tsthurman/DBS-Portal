import Link from "next/link";
import type { CSSProperties } from "react";
import {
  addDaysToDateKey,
  formatWeekRangeLabel,
  weekStartKeyForDate,
} from "../_lib/timezone";

interface WeekToolbarProps {
  weekStartKey: string;
}

export function WeekToolbar({ weekStartKey }: WeekToolbarProps) {
  const prevKey = addDaysToDateKey(weekStartKey, -7);
  const nextKey = addDaysToDateKey(weekStartKey, 7);
  const todayKey = weekStartKeyForDate(new Date());
  const rangeLabel = formatWeekRangeLabel(weekStartKey);

  const weekHref = (k: string) =>
    `/owner/calendar?view=week&week=${k}`;

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
        <Link href={weekHref(todayKey)} style={pillButton}>
          Today
        </Link>
        <Link
          href={weekHref(prevKey)}
          aria-label="Previous week"
          style={iconButton}
        >
          ◀
        </Link>
        <Link
          href={weekHref(nextKey)}
          aria-label="Next week"
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
          {rangeLabel}
        </h2>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ViewToggle activeWeekKey={weekStartKey} />
        {/*
          Phase 3 stub: this button is intentionally inert. Wiring to
          TimeBlockFormPanel lands with the day-panel work in the next PR.
        */}
        <button type="button" title="Coming soon" style={addButton}>
          + Add
        </button>
      </div>
    </div>
  );
}

interface ViewToggleProps {
  activeWeekKey: string;
}

function ViewToggle({ activeWeekKey }: ViewToggleProps) {
  const items: Array<{ label: string; href: string; active: boolean }> = [
    {
      label: "Week",
      href: `/owner/calendar?view=week&week=${activeWeekKey}`,
      active: true,
    },
    {
      label: "Month",
      href: `/owner/calendar?view=month`,
      active: false,
    },
    {
      label: "Agenda",
      href: `/owner/calendar?view=agenda`,
      active: false,
    },
  ];

  return (
    <div style={{ display: "inline-flex" }}>
      {items.map((item, i) => (
        <Link
          key={item.label}
          href={item.href}
          aria-pressed={item.active}
          style={{
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            border: "1px solid var(--border)",
            borderRight: i < items.length - 1 ? "none" : "1px solid var(--border)",
            backgroundColor: item.active ? "var(--accent)" : "transparent",
            color: item.active ? "#FFFFFF" : "var(--text-body)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          {item.label}
        </Link>
      ))}
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
