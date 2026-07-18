"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";

/**
 * Client segment error boundary. Renders inside the client layout, so the
 * sidebar and top bar stay put and only the page content is replaced — a
 * failure on one client page doesn't blank the whole app. (Errors thrown by
 * the client layout itself bubble up to the root boundary.)
 */
export default function ClientError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={wrapStyle}>
      <p style={eyebrowStyle}>Your Portal</p>
      <h1 style={titleStyle}>Something went wrong</h1>
      <p style={bodyStyle}>
        This page ran into a problem loading. You can try again.
      </p>
      <button type="button" onClick={reset} style={buttonStyle}>
        Try again
      </button>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  minHeight: "60vh",
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
  fontSize: 24,
  fontWeight: 500,
  letterSpacing: "-0.01em",
};

const bodyStyle: CSSProperties = {
  marginBottom: 28,
  color: "var(--text-body)",
  fontSize: 13,
  lineHeight: 1.6,
  maxWidth: 360,
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
