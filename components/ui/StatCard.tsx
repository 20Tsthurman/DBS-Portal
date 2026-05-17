import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "danger" | "muted";
  hint?: string;
}

const TONE_COLOR: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "var(--text-primary)",
  success: "var(--status-success)",
  danger: "var(--status-danger)",
  muted: "var(--text-muted)",
};

export function StatCard({ label, value, tone = "default", hint }: StatCardProps) {
  return (
    <div
      className="border px-5 py-4"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: "11px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "26px",
          fontWeight: 500,
          color: TONE_COLOR[tone],
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </p>
      {hint && (
        <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: "12px" }}>
          {hint}
        </p>
      )}
    </div>
  );
}
