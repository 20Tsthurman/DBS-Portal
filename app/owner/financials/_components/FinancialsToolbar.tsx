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
  const ytdHref = "/owner/financials?range=ytd";

  const centerLabel = isYtd ? yearLabel : formatMonthLabel(monthKey);

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
          style={{
            marginLeft: 4,
            fontFamily: "var(--font-playfair), serif",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          {centerLabel}
        </h2>

        {isYtd ? (
          <span
            style={{ ...disabledStyle(iconButton), marginLeft: 4 }}
            aria-disabled="true"
            aria-label="Next month (disabled in YTD view)"
          >
            ▶
          </span>
        ) : (
          <Link
            href={monthHref(nextKey)}
            aria-label="Next month"
            style={{ ...iconButton, marginLeft: 4 }}
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
