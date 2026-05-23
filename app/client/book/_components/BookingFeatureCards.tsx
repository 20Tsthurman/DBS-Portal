import type { CSSProperties, ReactNode } from "react";
import { IconBell, IconCheck, IconClock } from "./Icons";

export function BookingFeatureCards() {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FeatureCard
        icon={<IconClock size={18} color="var(--accent)" />}
        title="Easy Scheduling"
        subline="Choose a date and time that works best for you."
      />
      <FeatureCard
        icon={<IconCheck size={18} color="var(--accent)" />}
        title="Quick Confirmation"
        subline="We'll review and confirm your shoot request."
      />
      <FeatureCard
        icon={<IconBell size={18} color="var(--accent)" />}
        title="Stay Updated"
        subline="Get notified about your upcoming sessions."
      />
    </div>
  );
}

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  subline: string;
}

function FeatureCard({ icon, title, subline }: FeatureCardProps) {
  return (
    <div style={cardStyle}>
      <div style={iconWrapStyle}>{icon}</div>
      <div style={textWrapStyle}>
        <p style={titleStyle}>{title}</p>
        <p style={sublineStyle}>{subline}</p>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: 16,
  padding: "18px 20px",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
};

const iconWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  backgroundColor: "rgba(168, 120, 138, 0.12)",
  flexShrink: 0,
};

const textWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  margin: 0,
};

const sublineStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  margin: 0,
  lineHeight: 1.5,
};
