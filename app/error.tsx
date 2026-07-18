"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";

/**
 * Root-level error boundary. Catches errors thrown by root-level routes
 * (landing redirect, /finalizing, the auth group) that aren't handled by a
 * nested segment boundary. Errors thrown by the ROOT layout itself are caught
 * by app/global-error.tsx instead — this boundary renders inside the root
 * layout, so it can't cover the layout that hosts it.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console for debugging; users never see the stack.
    console.error(error);
  }, [error]);

  return (
    <main style={rootStyle}>
      <div style={cardStyle}>
        <p style={eyebrowStyle}>Client Portal</p>
        <h1 style={titleStyle}>Something went wrong</h1>
        <p style={bodyStyle}>
          An unexpected error stopped this page from loading. You can try
          again — if it keeps happening, refreshing usually clears it.
        </p>
        <button type="button" onClick={reset} style={buttonStyle}>
          Try again
        </button>
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
  marginBottom: 12,
  fontFamily: "var(--font-playfair), serif",
  color: "var(--text-primary)",
  fontSize: 28,
  fontWeight: 500,
  letterSpacing: "-0.01em",
};

const bodyStyle: CSSProperties = {
  marginBottom: 32,
  color: "var(--text-body)",
  fontSize: 13,
  lineHeight: 1.6,
};

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "none",
  cursor: "pointer",
};
