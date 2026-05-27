"use client";

import type { CSSProperties, ReactNode } from "react";

interface CardShellProps {
  children: ReactNode;
  /** Suggestion-card variant: accent-tinted background + 3px left border. */
  suggested?: boolean;
}

export function CardShell({ children, suggested = false }: CardShellProps) {
  return (
    <div
      style={{
        ...cardShellBaseStyle,
        ...(suggested ? cardShellSuggestedStyle : null),
      }}
    >
      {children}
    </div>
  );
}

interface CardRowProps {
  label: string;
  value: ReactNode;
  /** Render the value with the muted color (for empty/em-dash placeholders). */
  muted?: boolean;
  /** Override numeric value styling — adds tabular-nums + right alignment. */
  numeric?: boolean;
}

export function CardRow({ label, value, muted = false, numeric = false }: CardRowProps) {
  return (
    <div className="fb-card-row" style={cardRowStyle}>
      <span style={cardRowLabelStyle}>{label}</span>
      <span
        style={{
          ...cardRowValueStyle,
          color: muted ? "var(--text-muted)" : "var(--text-primary)",
          fontFeatureSettings: numeric ? '"tnum"' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** Drop into the page once. Removes the trailing border on the last
 * `.fb-card-row` inside a card so the divider pattern stops cleanly. */
export function CardRowStyles() {
  return (
    <style>{`
      .fb-card-row:last-child { border-bottom: none; }
    `}</style>
  );
}

export const headlineStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 20,
  fontWeight: 500,
  letterSpacing: "-0.01em",
  fontFeatureSettings: '"tnum"',
  marginBottom: 8,
};

export const fieldRowsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const cardShellBaseStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: 16,
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
};

const cardShellSuggestedStyle: CSSProperties = {
  borderLeft: "3px solid var(--accent)",
  backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--surface-raised))",
};

const cardRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  paddingTop: 8,
  paddingBottom: 8,
  borderBottom: "1px solid var(--border)",
};

const cardRowLabelStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  fontWeight: 600,
};

const cardRowValueStyle: CSSProperties = {
  fontSize: 14,
  textAlign: "right",
  color: "var(--text-primary)",
  wordBreak: "break-word",
};
