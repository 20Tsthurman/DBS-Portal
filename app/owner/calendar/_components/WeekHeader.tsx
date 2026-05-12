import Link from "next/link";
import {
  addWeeks,
  formatWeekParam,
  startOfWeek,
  weekLabel,
} from "../_lib/dateMath";

interface WeekHeaderProps {
  weekStart: Date;
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

export function WeekHeader({ weekStart }: WeekHeaderProps) {
  const prev = addWeeks(weekStart, -1);
  const next = addWeeks(weekStart, 1);
  const thisWeek = startOfWeek(new Date());

  const linkFor = (target: Date) =>
    `/owner/calendar?view=week&week=${formatWeekParam(target)}`;

  return (
    <div
      className="mb-6 flex items-center justify-between"
      style={{ gap: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href={linkFor(prev)}
          aria-label="Previous week"
          style={navButtonStyle}
        >
          ◀
        </Link>
        <Link
          href={linkFor(next)}
          aria-label="Next week"
          style={navButtonStyle}
        >
          ▶
        </Link>
        <Link href={linkFor(thisWeek)} style={todayButtonStyle}>
          This Week
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
        {weekLabel(weekStart)}
      </h2>
      <div style={{ width: 200 }} aria-hidden="true" />
    </div>
  );
}
