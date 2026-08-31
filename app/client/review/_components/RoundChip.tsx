import type { CSSProperties } from "react";
import { roundChip } from "../_lib/copy";

interface RoundChipProps {
  round: number;
}

/**
 * "Round 2" — the forest chip from the deck's status-pill table, shown from
 * round 2 on and never on round 1 (a first round is just "the month", and
 * labelling it would imply something had already gone around).
 *
 * Renders nothing below 2, so callers can drop it in unconditionally.
 */
export function RoundChip({ round }: RoundChipProps) {
  if (round < 2) return null;
  return <span style={chipStyle}>{roundChip(round)}</span>;
}

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  backgroundColor: "var(--sidebar-bg)",
  color: "#F2EDE4",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
