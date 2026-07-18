import Link from "next/link";
import type { CSSProperties } from "react";

/**
 * Root 404 page. Renders for unmatched routes and any notFound() call that
 * isn't caught by a segment-level not-found. Full-screen forest treatment to
 * match the root error/loading boundaries; a single primary-style link home —
 * the root route already redirects owner vs. client to the right dashboard, so
 * there's no need to branch here.
 */
export default function NotFound() {
  return (
    <main style={rootStyle}>
      <div style={cardStyle}>
        <p style={eyebrowStyle}>Client Portal</p>
        <h1 style={titleStyle}>Page not found</h1>
        <p style={bodyStyle}>
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have
          moved.
        </p>
        <Link href="/" style={linkStyle}>
          Back to home
        </Link>
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

const linkStyle: CSSProperties = {
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
