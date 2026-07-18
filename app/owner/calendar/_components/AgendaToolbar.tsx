import Link from "next/link";
import type { CSSProperties } from "react";
import {
  addDaysToDateKey,
  shortDateLabelForDateKey,
} from "../_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";

interface AgendaToolbarProps {
  startDateKey: string;
  days: number;
}

export function AgendaToolbar({ startDateKey, days }: AgendaToolbarProps) {
  const todayKey = dateKeyInTimezone(new Date());
  const prevKey = addDaysToDateKey(startDateKey, -days);
  const nextKey = addDaysToDateKey(startDateKey, days);
  const endKey = addDaysToDateKey(startDateKey, Math.max(0, days - 1));

  const label =
    startDateKey === todayKey
      ? `Next ${days} days`
      : formatRangeLabel(startDateKey, endKey);

  const hrefForStart = (k: string) =>
    `/owner/calendar?view=agenda&start=${k}`;

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
          href={hrefForStart(todayKey)}
          className="min-h-[44px] lg:min-h-0"
          style={pillButton}
        >
          Today
        </Link>
        <Link
          href={hrefForStart(prevKey)}
          aria-label={`Previous ${days} days`}
          className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
          style={iconButton}
        >
          ◀
        </Link>
        <Link
          href={hrefForStart(nextKey)}
          aria-label={`Next ${days} days`}
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
        <ViewToggle activeStartKey={startDateKey} />
        <Link
          href={`/owner/calendar?view=agenda&start=${startDateKey}&new=time_block`}
          className="min-h-[44px] lg:min-h-0"
          style={addButton}
        >
          + Add
        </Link>
      </div>
    </div>
  );
}

function formatRangeLabel(startKey: string, endKey: string): string {
  const [sy] = startKey.split("-").map(Number);
  const [ey] = endKey.split("-").map(Number);
  const startLabel = shortDateLabelForDateKey(startKey);
  const endLabel = shortDateLabelForDateKey(endKey);
  if (sy !== ey) {
    return `${startLabel}, ${sy} – ${endLabel}, ${ey}`;
  }
  return `${startLabel} – ${endLabel}, ${sy}`;
}

interface ViewToggleProps {
  activeStartKey: string;
}

function ViewToggle({ activeStartKey }: ViewToggleProps) {
  const items: Array<{ label: string; href: string; active: boolean }> = [
    {
      label: "Week",
      href: `/owner/calendar?view=week`,
      active: false,
    },
    {
      label: "Month",
      href: `/owner/calendar?view=month`,
      active: false,
    },
    {
      label: "Agenda",
      href: `/owner/calendar?view=agenda&start=${activeStartKey}`,
      active: true,
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
