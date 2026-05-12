import Link from "next/link";

interface ViewToggleProps {
  active: "month" | "week";
  monthHref: string;
  weekHref: string;
}

const baseStyle = {
  padding: "8px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  border: "1px solid var(--border)",
  fontFamily: "inherit",
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
};

export function ViewToggle({ active, monthHref, weekHref }: ViewToggleProps) {
  const monthActive = active === "month";
  const weekActive = active === "week";
  return (
    <div style={{ display: "inline-flex" }}>
      <Link
        href={monthHref}
        aria-pressed={monthActive}
        style={{
          ...baseStyle,
          backgroundColor: monthActive ? "var(--accent)" : "transparent",
          color: monthActive ? "#FFFFFF" : "var(--text-body)",
          borderRight: "none",
        }}
      >
        Month
      </Link>
      <Link
        href={weekHref}
        aria-pressed={weekActive}
        style={{
          ...baseStyle,
          backgroundColor: weekActive ? "var(--accent)" : "transparent",
          color: weekActive ? "#FFFFFF" : "var(--text-body)",
        }}
      >
        Week
      </Link>
    </div>
  );
}
