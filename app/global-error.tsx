"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
// global-error REPLACES the root layout when the root layout itself throws,
// so it must provide its own <html>/<body> and pull in the design tokens.
// The next/font CSS variables aren't applied here (they live on the root
// layout's <html>), so type falls back to the serif/system stacks below —
// colours and layout stay fully on-brand via the :root vars in globals.css.
import "./globals.css";

export default function GlobalError({
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
    <html lang="en">
      <body>
        <main style={rootStyle}>
          <div style={cardStyle}>
            <p style={eyebrowStyle}>Client Portal</p>
            <h1 style={titleStyle}>Something went wrong</h1>
            <p style={bodyStyle}>
              The portal hit an unexpected error. Try again — if it persists,
              please reload the page.
            </p>
            <button type="button" onClick={reset} style={buttonStyle}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
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
  fontFamily: "var(--font-playfair), Georgia, serif",
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
