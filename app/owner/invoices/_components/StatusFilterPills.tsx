import Link from "next/link";
import type { CSSProperties } from "react";

export type StatusFilter = "all" | "open" | "draft" | "sent" | "paid";

interface StatusFilterPillsProps {
  active: StatusFilter;
}

const ITEMS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
];

export function StatusFilterPills({ active }: StatusFilterPillsProps) {
  return (
    <div style={containerStyle}>
      {ITEMS.map((item, i) => {
        const isActive = item.value === active;
        // `open` is the default; omitting the query param keeps URLs clean.
        const href =
          item.value === "open"
            ? "/owner/invoices"
            : `/owner/invoices?status=${item.value}`;
        return (
          <Link
            key={item.value}
            href={href}
            aria-pressed={isActive}
            style={{
              ...pillStyle,
              borderRight:
                i < ITEMS.length - 1 ? "none" : "1px solid var(--border)",
              backgroundColor: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "#FFFFFF" : "var(--text-body)",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

// Wraps rather than overflowing: five pills measure ~330-345px against ~343px
// of content width at 375px, and body{overflow-x:hidden} would clip the last
// filter out of reach instead of letting it scroll.
const containerStyle: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  marginBottom: 24,
};

const pillStyle: CSSProperties = {
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  border: "1px solid var(--border)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
