import Link from "next/link";
import {
  addMonths,
  currentYearMonth,
  formatMonthParam,
  monthLabel,
  type YearMonth,
} from "../_lib/dateMath";

interface MonthHeaderProps {
  ym: YearMonth;
}

const navButtonStyle = {
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

const todayButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 36,
  padding: "0 14px",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  backgroundColor: "var(--surface-raised)",
  marginLeft: 8,
};

export function MonthHeader({ ym }: MonthHeaderProps) {
  const prev = addMonths(ym, -1);
  const next = addMonths(ym, 1);
  const today = currentYearMonth();

  const linkFor = (target: YearMonth) =>
    `/owner/calendar?month=${formatMonthParam(target)}`;

  return (
    <div
      className="mb-6 flex items-center justify-between"
      style={{ gap: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href={linkFor(prev)}
          aria-label="Previous month"
          style={navButtonStyle}
        >
          ◀
        </Link>
        <Link
          href={linkFor(next)}
          aria-label="Next month"
          style={navButtonStyle}
        >
          ▶
        </Link>
        <Link href={linkFor(today)} style={todayButtonStyle}>
          Today
        </Link>
      </div>
      <h2
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: 24,
          fontWeight: 500,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {monthLabel(ym)}
      </h2>
      <div style={{ width: 200 }} aria-hidden="true" />
    </div>
  );
}
