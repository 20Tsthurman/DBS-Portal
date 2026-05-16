import type { ReactNode } from "react";

interface DashboardCardProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
}

/**
 * Outer shell for every dashboard widget.
 *
 * Card: --surface-raised, 1px --border, sharp corners (enforced globally),
 * 24px padding. Header row: uppercase eyebrow + Playfair 20px title.
 */
export function DashboardCard({ eyebrow, title, children }: DashboardCardProps) {
  return (
    <div
      className="border"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
        padding: 24,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          {eyebrow}
        </p>
        <h2
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: 20,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          {title}
        </h2>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
