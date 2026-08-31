import type { CSSProperties } from "react";
import { DEADLINE_EXPLAINER, deadlineHeadline } from "../_lib/copy";

interface DeadlineCardProps {
  /** "Friday, September 25" — weekday and date, no year. */
  deadlineLabel: string;
}

/**
 * The deadline, stated once at the top of the queue (copy deck Screen 1).
 *
 * Line 2 is the same sentence the release email carries, imported from one
 * constant — the deck calls for them to be verbatim identical, because the
 * client meets it first in their inbox and should recognise it here rather
 * than parse a second, differently-worded version of the same rule.
 *
 * Forest ground rather than a warning colour: the auto-approve rule is how the
 * plan works, not a threat, and the tone requirement (spec §5.8) is that
 * nothing on this surface feels punitive.
 */
export function DeadlineCard({ deadlineLabel }: DeadlineCardProps) {
  return (
    <div style={cardStyle}>
      <p style={headlineStyle}>{deadlineHeadline(deadlineLabel)}</p>
      <p style={explainerStyle}>{DEADLINE_EXPLAINER}</p>
    </div>
  );
}

const cardStyle: CSSProperties = {
  backgroundColor: "var(--sidebar-bg)",
  padding: "16px 18px",
  marginBottom: 20,
};

const headlineStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-playfair), serif",
  fontSize: 18,
  fontWeight: 500,
  color: "#FFFFFF",
};

const explainerStyle: CSSProperties = {
  margin: "6px 0 0",
  maxWidth: "62ch",
  fontSize: 13,
  lineHeight: 1.6,
  color: "rgba(242, 237, 228, 0.75)",
};
