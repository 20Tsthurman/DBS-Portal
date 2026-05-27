import Link from "next/link";
import type { CSSProperties } from "react";
import {
  addMonthsToMonthKey,
  formatMonthLabel,
} from "@/app/owner/calendar/_lib/timezone";

interface FinancialsToolbarProps {
  range: "month" | "ytd";
  monthKey: string;
  yearLabel: string;
}

/**
 * Mobile-first layout:
 *   row 1: [Today] [◀]   <Month YYYY>   [▶]    — month nav, label centered, full width
 *   row 2: [   Month   |   YTD   ]              — range toggle, full width
 *
 * Desktop (≥lg): both rows collapse into the existing single-row layout
 * (month nav cluster on the left, range toggle on the right).
 */
export function FinancialsToolbar({
  range,
  monthKey,
  yearLabel,
}: FinancialsToolbarProps) {
  const isYtd = range === "ytd";
  const prevKey = addMonthsToMonthKey(monthKey, -1);
  const nextKey = addMonthsToMonthKey(monthKey, 1);

  const monthHref = (k: string) =>
    `/owner/financials?range=month&month=${k}`;
  const todayHref = "/owner/financials";

  const centerLabel = isYtd ? yearLabel : formatMonthLabel(monthKey);

  return (
    <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center lg:gap-3">
      <div className="flex items-center gap-2">
        {isYtd ? (
          <span style={disabledStyle(pillButton)} aria-disabled="true">
            Today
          </span>
        ) : (
          <Link href={todayHref} style={pillButton}>
            Today
          </Link>
        )}

        {isYtd ? (
          <span
            style={disabledStyle(iconButton)}
            aria-disabled="true"
            aria-label="Previous month (disabled in YTD view)"
          >
            ◀
          </span>
        ) : (
          <Link
            href={monthHref(prevKey)}
            aria-label="Previous month"
            style={iconButton}
          >
            ◀
          </Link>
        )}

        <h2
          className="flex-1 text-center lg:flex-initial lg:px-2 lg:text-left"
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            margin: 0,
            minWidth: 0,
          }}
        >
          {centerLabel}
        </h2>

        {isYtd ? (
          <span
            style={disabledStyle(iconButton)}
            aria-disabled="true"
            aria-label="Next month (disabled in YTD view)"
          >
            ▶
          </span>
        ) : (
          <Link
            href={monthHref(nextKey)}
            aria-label="Next month"
            style={iconButton}
          >
            ▶
          </Link>
        )}
      </div>

      <RangeToggle range={range} monthKey={monthKey} />
    </div>
  );
}

interface RangeToggleProps {
  range: "month" | "ytd";
  monthKey: string;
}

function RangeToggle({ range, monthKey }: RangeToggleProps) {
  const items: Array<{ label: string; href: string; active: boolean }> = [
    {
      label: "Month",
      href: `/owner/financials?range=month&month=${monthKey}`,
      active: range === "month",
    },
    {
      label: "YTD",
      href: "/owner/financials?range=ytd",
      active: range === "ytd",
    },
  ];

  return (
    <div className="flex w-full lg:inline-flex lg:w-auto">
      {items.map((item, i) => (
        <Link
          key={item.label}
          href={item.href}
          aria-pressed={item.active}
          className="flex-1 justify-center lg:flex-initial"
          style={{
            padding: "10px 16px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            border: "1px solid var(--border)",
            borderRight:
              i < items.length - 1
                ? "none"
                : "1px solid var(--border)",
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

function disabledStyle(base: CSSProperties): CSSProperties {
  return {
    ...base,
    opacity: 0.4,
    pointerEvents: "none",
    cursor: "default",
  };
}

const pillButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flexShrink: 0,
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
  flexShrink: 0,
  width: 36,
  height: 36,
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 14,
  lineHeight: 1,
  backgroundColor: "var(--surface-raised)",
};
