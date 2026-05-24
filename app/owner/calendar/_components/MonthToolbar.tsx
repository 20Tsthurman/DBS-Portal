import Link from "next/link";
import type { CSSProperties } from "react";
import {
  addMonthsToMonthKey,
  combineDateAndTimeInTimezone,
  currentMonthKey,
  formatMonthLabel,
  weekStartKeyForDate,
} from "../_lib/timezone";

interface MonthToolbarProps {
  monthKey: string;
}

export function MonthToolbar({ monthKey }: MonthToolbarProps) {
  const prevKey = addMonthsToMonthKey(monthKey, -1);
  const nextKey = addMonthsToMonthKey(monthKey, 1);
  const todayMonth = currentMonthKey();
  const label = formatMonthLabel(monthKey);

  const monthHref = (k: string) => `/owner/calendar?view=month&month=${k}`;

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
        <Link
          href={monthHref(todayMonth)}
          className="min-h-[44px] lg:min-h-0"
          style={pillButton}
        >
          Today
        </Link>
        <Link
          href={monthHref(prevKey)}
          aria-label="Previous month"
          className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
          style={iconButton}
        >
          ◀
        </Link>
        <Link
          href={monthHref(nextKey)}
          aria-label="Next month"
          className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
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

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ViewToggle activeMonthKey={monthKey} />
        <Link
          href={`/owner/calendar?view=month&month=${monthKey}&new=time_block`}
          className="min-h-[44px] lg:min-h-0"
          style={addButton}
        >
          + Add
        </Link>
      </div>
    </div>
  );
}

interface ViewToggleProps {
  activeMonthKey: string;
}

function ViewToggle({ activeMonthKey }: ViewToggleProps) {
  // Week link: if the displayed month is the current month, land on the week
  // containing today; otherwise land on the week containing the 1st of the
  // displayed month. This matches the historic week-↔-month bridge behavior.
  const todayMonth = currentMonthKey();
  const weekProbeKey =
    activeMonthKey === todayMonth
      ? weekStartKeyForDate(new Date())
      : weekStartKeyForDate(
          combineDateAndTimeInTimezone(`${activeMonthKey}-01`, "12:00")
        );

  const items: Array<{ label: string; href: string; active: boolean }> = [
    {
      label: "Week",
      href: `/owner/calendar?view=week&week=${weekProbeKey}`,
      active: false,
    },
    {
      label: "Month",
      href: `/owner/calendar?view=month&month=${activeMonthKey}`,
      active: true,
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
          className={`min-h-[44px] lg:min-h-0 ${
            item.label === "Week" ? "!hidden lg:!inline-flex" : ""
          }`}
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
