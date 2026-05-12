import type { ProjectPhase } from "@/lib/supabase";

const PHASES: { key: ProjectPhase; label: string }[] = [
  { key: "onboarding", label: "Onboarding" },
  { key: "strategy", label: "Strategy" },
  { key: "content", label: "Content Creation" },
  { key: "reporting", label: "Reporting" },
];

interface PhaseTrackerProps {
  current: ProjectPhase | null;
}

type Position = "completed" | "current" | "upcoming";

function positionFor(
  current: ProjectPhase | null,
  index: number
): Position {
  if (!current) return index === 0 ? "current" : "upcoming";
  const currentIndex = PHASES.findIndex((p) => p.key === current);
  if (index < currentIndex) return "completed";
  if (index === currentIndex) return "current";
  return "upcoming";
}

const styles: Record<Position, { bg: string; fg: string }> = {
  completed: { bg: "var(--sidebar-bg)", fg: "#FFFFFF" },
  current: { bg: "var(--accent)", fg: "#FFFFFF" },
  upcoming: { bg: "var(--border)", fg: "var(--text-muted)" },
};

export function PhaseTracker({ current }: PhaseTrackerProps) {
  return (
    <div className="flex w-full items-stretch">
      {PHASES.map((phase, index) => {
        const pos = positionFor(current, index);
        const style = styles[pos];
        const isLast = index === PHASES.length - 1;
        return (
          <div
            key={phase.key}
            className="flex flex-1 items-center"
            style={{ minWidth: 0 }}
          >
            <div
              className="flex w-full items-center justify-center px-3 py-3 text-center"
              style={{
                backgroundColor: style.bg,
                color: style.fg,
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {phase.label}
            </div>
            {!isLast && (
              <div
                style={{
                  width: 16,
                  height: 1,
                  backgroundColor: "var(--border)",
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
