import type { ReactNode } from "react";

type Tone = "success" | "warning" | "danger" | "neutral" | "accent";

interface StatusPillProps {
  tone?: Tone;
  children: ReactNode;
}

const toneColors: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: "rgba(45, 106, 79, 0.12)", fg: "var(--status-success)" },
  warning: { bg: "rgba(139, 105, 20, 0.12)", fg: "var(--status-warning)" },
  danger: { bg: "rgba(122, 48, 64, 0.12)", fg: "var(--status-danger)" },
  neutral: { bg: "rgba(122, 139, 124, 0.14)", fg: "var(--text-body)" },
  accent: { bg: "rgba(168, 120, 138, 0.16)", fg: "var(--accent)" },
};

export function StatusPill({ tone = "neutral", children }: StatusPillProps) {
  const palette = toneColors[tone];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: palette.bg, color: palette.fg }}
    >
      {children}
    </span>
  );
}
