import type { CSSProperties } from "react";
import type { ProjectPhase } from "@/lib/supabase";

interface PhaseTrackerProps {
  /** The project's current phase, or null when the client has no project. */
  currentPhase: ProjectPhase | null;
}

/** Ordered to match the `projects_current_phase_check` enum. */
const PHASES: { key: ProjectPhase; label: string }[] = [
  { key: "onboarding", label: "Onboarding" },
  { key: "strategy", label: "Strategy" },
  { key: "content", label: "Content" },
  { key: "reporting", label: "Reporting" },
];

export function PhaseTracker({ currentPhase }: PhaseTrackerProps) {
  if (!currentPhase) {
    return (
      <div style={emptyStateStyle}>
        Your project hasn&apos;t kicked off yet. Once Kelsey sets things up,
        you&apos;ll see your progress here.
      </div>
    );
  }

  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div style={cardStyle}>
      <ol style={trackStyle}>
        {PHASES.map((phase, idx) => {
          const state =
            idx < currentIndex
              ? "complete"
              : idx === currentIndex
                ? "current"
                : "future";
          return (
            <li key={phase.key} style={stepStyle}>
              {idx > 0 && (
                <span
                  aria-hidden
                  style={{
                    ...connectorStyle,
                    backgroundColor:
                      idx <= currentIndex
                        ? "var(--text-primary)"
                        : "var(--border)",
                  }}
                />
              )}
              <span style={indicatorFor(state)}>{idx + 1}</span>
              <span style={labelFor(state)}>{phase.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type StepState = "complete" | "current" | "future";

function indicatorFor(state: StepState): CSSProperties {
  switch (state) {
    case "complete":
      return {
        ...indicatorBase,
        backgroundColor: "var(--text-primary)",
        color: "#FFFFFF",
        border: "1px solid var(--text-primary)",
      };
    case "current":
      return {
        ...indicatorBase,
        backgroundColor: "var(--accent)",
        color: "#FFFFFF",
        border: "1px solid var(--accent)",
      };
    case "future":
      return {
        ...indicatorBase,
        backgroundColor: "transparent",
        color: "var(--text-muted)",
        border: "1px solid var(--border)",
      };
  }
}

function labelFor(state: StepState): CSSProperties {
  return {
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
    color:
      state === "future" ? "var(--text-muted)" : "var(--text-primary)",
    fontWeight: state === "current" ? 600 : 500,
  };
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "28px 24px",
};

const trackStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  alignItems: "flex-start",
};

const stepStyle: CSSProperties = {
  flex: 1,
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

// The connector spans the gap to the previous step's indicator: it starts at
// the left edge of this step and runs to the left edge's center, sitting on
// the vertical center line of the 32px indicator.
const connectorStyle: CSSProperties = {
  position: "absolute",
  top: 15,
  right: "50%",
  left: "-50%",
  height: 2,
};

const indicatorBase: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  fontSize: 13,
  fontWeight: 600,
};

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 14,
};
