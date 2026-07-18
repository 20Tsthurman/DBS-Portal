import type { CSSProperties } from "react";

/**
 * Root-level loading boundary. Shown during navigation to root-level routes
 * (landing redirect, /finalizing, the auth group), which render on the forest
 * background with no app chrome — so this matches the full-screen /finalizing
 * treatment rather than the in-app segment loaders.
 */
export default function RootLoading() {
  return (
    <main style={rootStyle}>
      <div style={cardStyle}>
        <p style={eyebrowStyle}>Client Portal</p>
        <h1 style={titleStyle}>Loading…</h1>
        <div style={spinnerRowStyle} aria-hidden="true">
          <div className="animate-spin" style={spinnerStyle} />
        </div>
        <span className="sr-only">Loading</span>
      </div>
    </main>
  );
}

const rootStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 24px",
  backgroundColor: "var(--sidebar-bg)",
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 448,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-base)",
  padding: "48px 40px",
  textAlign: "center",
};

const eyebrowStyle: CSSProperties = {
  marginBottom: 12,
  color: "var(--text-muted)",
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  fontWeight: 500,
};

const titleStyle: CSSProperties = {
  marginBottom: 32,
  fontFamily: "var(--font-playfair), serif",
  color: "var(--text-primary)",
  fontSize: 28,
  fontWeight: 500,
  letterSpacing: "-0.01em",
};

const spinnerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

const spinnerStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: "2px solid var(--border)",
  borderTopColor: "var(--accent)",
  borderRadius: "50%",
};
