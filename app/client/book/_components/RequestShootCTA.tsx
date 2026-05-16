import Link from "next/link";
import type { CSSProperties } from "react";
import { IconCalendarPlus } from "./Icons";

interface RequestShootCTAProps {
  /** URL to navigate to when the button is clicked. */
  href: string;
}

export function RequestShootCTA({ href }: RequestShootCTAProps) {
  return (
    <div style={bannerStyle}>
      <div style={iconWrapStyle}>
        <IconCalendarPlus size={32} color="var(--accent)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          Ready to book?
        </p>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            margin: 0,
            marginTop: 4,
          }}
        >
          Pick a date and time that works for you.
        </p>
      </div>
      <Link href={href} className="client-cta-button" style={buttonStyle}>
        + Request a Shoot
      </Link>
    </div>
  );
}

const bannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 20,
  flexWrap: "wrap",
  padding: "24px 0",
  margin: "0 0 24px 0",
  backgroundColor: "rgba(168, 120, 138, 0.04)",
  borderTop: "1px solid var(--border)",
  borderBottom: "1px solid var(--border)",
};

const iconWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 64,
  height: 64,
  marginLeft: 8,
  backgroundColor: "rgba(168, 120, 138, 0.12)",
  flexShrink: 0,
};

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "14px 24px",
  marginRight: 8,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  fontSize: 14,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  textDecoration: "none",
};
