import type { CSSProperties, ReactNode } from "react";

type StatCardTone = "default" | "success" | "danger" | "muted";

interface StatCardSecondary {
  label: string;
  value: ReactNode;
  tone?: StatCardTone;
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  tone?: StatCardTone;
  hint?: string;
  icon?: ReactNode;
  secondary?: StatCardSecondary;
}

const TONE_COLOR: Record<StatCardTone, string> = {
  default: "var(--text-primary)",
  success: "var(--status-success)",
  danger: "var(--status-danger)",
  muted: "var(--text-muted)",
};

const TONE_TILE_BG: Record<StatCardTone, string> = {
  default: "color-mix(in srgb, var(--text-primary) 8%, transparent)",
  success: "color-mix(in srgb, var(--status-success) 12%, transparent)",
  danger: "color-mix(in srgb, var(--status-danger) 12%, transparent)",
  muted: "color-mix(in srgb, var(--accent) 10%, transparent)",
};

const labelStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "11px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 600,
  marginBottom: 8,
};

const primaryValueStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: "36px",
  fontWeight: 500,
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
};

const secondaryValueStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: "26px",
  fontWeight: 500,
  letterSpacing: "-0.01em",
  lineHeight: 1.1,
};

export function StatCard({
  label,
  value,
  tone = "default",
  hint,
  icon,
  secondary,
}: StatCardProps) {
  return (
    <div
      className="border px-6 py-6"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {icon && (
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: TONE_TILE_BG[tone],
              color: TONE_COLOR[tone],
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={labelStyle}>{label}</p>
          <p style={{ ...primaryValueStyle, color: TONE_COLOR[tone] }}>{value}</p>
          {hint && (
            <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: "12px" }}>
              {hint}
            </p>
          )}
        </div>
      </div>
      {secondary && (
        <>
          <div
            style={{
              marginTop: 20,
              borderTop: "1px solid var(--border)",
            }}
          />
          <p style={{ ...labelStyle, marginTop: 16 }}>{secondary.label}</p>
          <p
            style={{
              ...secondaryValueStyle,
              color: TONE_COLOR[secondary.tone ?? "default"],
            }}
          >
            {secondary.value}
          </p>
        </>
      )}
    </div>
  );
}
