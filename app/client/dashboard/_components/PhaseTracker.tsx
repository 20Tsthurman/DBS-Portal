import type { CSSProperties } from "react";
import type { ProjectPhase } from "@/lib/supabase";

/**
 * PENDING COPY REVIEW.
 *
 * Every client-facing string the tracker renders, in one place. The four
 * phase blurbs, the two eyebrows, and the wrapped-up state were drafted on
 * 2026-09-04 to build against and have NOT been through a copy pass. Swap
 * them here — nothing below this export holds copy of its own. The four
 * phase labels are a locked decision and live in `PHASES`, not here.
 */
export const PHASE_TRACKER_COPY = {
  /** Eyebrow while the project is in progress; `.eyebrow` uppercases it. */
  eyebrowInProgress: (step: number, total: number) =>
    `Current phase · ${step} of ${total}`,
  /** Eyebrow, title, and blurb once `projects.status` is 'completed'. */
  eyebrowCompleted: "Project complete",
  completedTitle: "Wrapped up",
  completedBlurb:
    "This project has wrapped up. Your files, invoices, and messages stay right here whenever you need them.",
  /** One sentence under the phase name: what is happening right now. */
  blurbs: {
    onboarding:
      "We're getting everything set up: access, brand details, and what we need before your first shoot.",
    strategy:
      "We're shaping your content plan, from pillars and posting cadence to the look and feel of your feed.",
    content:
      "Shoots, edits, and posts are in motion. Each month's content comes to you for review before it goes live.",
    reporting:
      "We're looking at what worked, what reached people, and what to adjust for the months ahead.",
  } satisfies Record<ProjectPhase, string>,
};

/**
 * The four phases in order. Locked labels — the client-facing names were
 * decided with the feature, so they sit apart from the copy above. The
 * array index is the step number minus one.
 */
const PHASES = [
  { key: "onboarding", label: "Onboarding" },
  { key: "strategy", label: "Strategy" },
  { key: "content", label: "Content" },
  { key: "reporting", label: "Reporting" },
] as const satisfies ReadonlyArray<{ key: ProjectPhase; label: string }>;

type StepState = "done" | "current" | "upcoming";

interface PhaseTrackerProps {
  /**
   * The project's current phase. Never null: the page resolves a missing
   * projects row to 'onboarding' before this component sees it.
   */
  phase: ProjectPhase;
  /**
   * True when `projects.status` is 'completed'. Every bar fills and the copy
   * says the engagement has wrapped, whatever phase the row was left on.
   */
  completed: boolean;
}

/**
 * Read-only "where things stand" card at the top of the client dashboard —
 * the one element with content on a brand-new client's first day, so it
 * carries the first impression. Server component, no client JS.
 *
 * Two zones, whitespace between them rather than a rule: the statement (an
 * eyebrow with the step count, the phase name, one sentence on what is
 * happening now) and the track (four flat bars with their labels beneath).
 *
 * Three bar states, all from existing tokens. Mauve already means "you are
 * here" across the portal — the sidebar's active item, the "Needs your
 * review" pill, the review banner's left rule — so it marks the current
 * phase. Finished phases fill in the sidebar's deep green; what is ahead
 * stays the faint border sand so the eye lands on the mauve.
 *
 * The phase name is an <h3>, not an <h2>: the page owns the "Your Project"
 * section title above the card, and the name inside sits one level down at
 * the same 18px Playfair the review queue's banner uses for a heading
 * inside a card.
 *
 * Four labels fit one row at the narrowest phone width, so there is no
 * breakpoint; `minmax(0, 1fr)` lets a label wrap rather than push the grid.
 *
 * Read-only by design. Clients never change their own phase, and there is
 * no phase-editing surface anywhere yet, owner side included.
 */
export function PhaseTracker({ phase, completed }: PhaseTrackerProps) {
  // The CHECK constraint on projects.current_phase makes a miss unreachable.
  // Clamping to the first step is one line against ever rendering a track
  // with nothing lit.
  const currentIndex = Math.max(
    0,
    PHASES.findIndex((step) => step.key === phase)
  );
  const current = PHASES[currentIndex] ?? PHASES[0];

  const stateAt = (index: number): StepState => {
    if (completed || index < currentIndex) return "done";
    if (index === currentIndex) return "current";
    return "upcoming";
  };

  const eyebrow = completed
    ? PHASE_TRACKER_COPY.eyebrowCompleted
    : PHASE_TRACKER_COPY.eyebrowInProgress(currentIndex + 1, PHASES.length);
  const title = completed ? PHASE_TRACKER_COPY.completedTitle : current.label;
  const blurb = completed
    ? PHASE_TRACKER_COPY.completedBlurb
    : PHASE_TRACKER_COPY.blurbs[current.key];

  return (
    <div data-tour="phase-tracker" style={cardStyle}>
      <p className="eyebrow" style={eyebrowStyle}>
        {eyebrow}
      </p>
      <h3 style={titleStyle}>{title}</h3>
      <p style={blurbStyle}>{blurb}</p>

      <ol aria-label="Project phases" style={trackStyle}>
        {PHASES.map((step, index) => {
          const state = stateAt(index);
          return (
            <li
              key={step.key}
              aria-current={state === "current" ? "step" : undefined}
              style={stepStyle}
            >
              <div
                style={{ ...barStyle, backgroundColor: BAR_COLOR[state] }}
              />
              <p style={{ ...labelStyle, ...LABEL_STYLE[state] }}>
                {step.label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "24px 28px",
};

const eyebrowStyle: CSSProperties = {
  margin: "0 0 6px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-playfair), serif",
  fontSize: 18,
  fontWeight: 500,
  color: "var(--text-primary)",
  letterSpacing: "-0.01em",
  lineHeight: 1.3,
};

const blurbStyle: CSSProperties = {
  margin: "6px 0 0",
  maxWidth: "62ch",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-body)",
};

const trackStyle: CSSProperties = {
  listStyle: "none",
  margin: "24px 0 0",
  padding: 0,
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 4,
};

const stepStyle: CSSProperties = {
  minWidth: 0,
};

const barStyle: CSSProperties = {
  height: 4,
};

const labelStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13,
  lineHeight: 1.3,
};

const BAR_COLOR: Record<StepState, string> = {
  done: "var(--sidebar-bg)",
  current: "var(--accent)",
  upcoming: "var(--border)",
};

const LABEL_STYLE: Record<StepState, CSSProperties> = {
  done: { color: "var(--text-body)", fontWeight: 500 },
  current: { color: "var(--text-primary)", fontWeight: 600 },
  upcoming: { color: "var(--text-muted)", fontWeight: 400 },
};
