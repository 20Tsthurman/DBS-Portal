import Link from "next/link";
import type { CSSProperties } from "react";
import { contentHref, type ContentView } from "../_lib/href";

interface ViewToggleProps {
  view: ContentView;
  monthKey: string;
  clientId: string | null;
}

/**
 * Calendar / List switch, rendered on the same row as the month stepper —
 * a view is a filter on the same URL, so the toggle preserves month and
 * client and vice versa.
 */
export function ViewToggle({ view, monthKey, clientId }: ViewToggleProps) {
  const items: Array<{ view: ContentView; label: string }> = [
    { view: "calendar", label: "Calendar" },
    { view: "list", label: "List" },
  ];

  return (
    <div style={containerStyle}>
      {items.map((item, i) => {
        const isActive = item.view === view;
        return (
          <Link
            key={item.view}
            href={contentHref({ monthKey, clientId, view: item.view })}
            aria-pressed={isActive}
            style={{
              ...pillStyle,
              borderRight:
                i < items.length - 1 ? "none" : "1px solid var(--border)",
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

const containerStyle: CSSProperties = {
  display: "inline-flex",
  marginBottom: 16,
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
