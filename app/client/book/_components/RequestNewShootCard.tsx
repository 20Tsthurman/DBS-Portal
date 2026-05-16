import Link from "next/link";
import type { CSSProperties } from "react";

interface RequestNewShootCardProps {
  href: string;
}

export function RequestNewShootCard({ href }: RequestNewShootCardProps) {
  return (
    <section style={cardStyle}>
      <p style={headingStyle}>Need to book a new shoot?</p>
      <p style={sublineStyle}>
        We&apos;ll review your request and confirm the details with you.
      </p>
      <Link href={href} className="client-cta-button" style={buttonStyle}>
        + Request a Shoot
      </Link>
    </section>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 24,
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
};

const headingStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: "var(--text-primary)",
  margin: 0,
};

const sublineStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  margin: 0,
  lineHeight: 1.5,
};

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "12px 16px",
  marginTop: 4,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  textDecoration: "none",
};
