import type { CSSProperties } from "react";

/**
 * Owner segment loading boundary. Renders inside the owner layout (sidebar +
 * top bar stay), so this is a centered spinner in the content area rather than
 * a full-screen splash.
 */
export default function OwnerLoading() {
  return (
    <div style={wrapStyle}>
      <div className="animate-spin" style={spinnerStyle} aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "60vh",
};

const spinnerStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: "2px solid var(--border)",
  borderTopColor: "var(--accent)",
  borderRadius: "50%",
};
