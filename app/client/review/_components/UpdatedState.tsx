import type { CSSProperties } from "react";
import { RoundChip } from "./RoundChip";
import {
  UPDATED_BODY,
  UPDATED_NOTE_LABEL,
  UPDATED_SMALL_PRINT_CHARGE,
  UPDATED_SMALL_PRINT_COVERED,
  UPDATED_TITLE,
} from "../_lib/copy";

interface UpdatedStateProps {
  /** The post's `current_round` after re-release — 2 or more, so the chip shows. */
  round: number;
  /**
   * Kelsey's optional note on the accept (`revision_rounds.resolution_note`).
   * Null, or empty, when she attached none — the label block is omitted rather
   * than rendered over nothing.
   */
  note: string | null;
  /**
   * The small print about the next round's cost, chosen by the page from the
   * same billing state the actions use: "charge" when the round the client
   * would open carries one (the held deck row), "covered" when another post
   * already opened it (the row added 2026-09-04), null when the round is
   * included — in which case nothing renders, as in Phase 6.
   */
  smallPrint: "charge" | "covered" | null;
}

/**
 * The updated state (copy deck Screen 5, "Updated"): a post that came back
 * after a re-release, open for review again at round 2 or later. Renders
 * ABOVE the Screen 2 actions — the same Approve / Request changes pair — so
 * the client reads what happened, then decides.
 *
 * THE SMALL PRINT is the last line, and only on a post whose next round would
 * cost something: the held row's promise ("you'll always see the amount
 * before anything is sent") is kept by the Screen 9 dialog one press later,
 * and the covered row is for the post where that promise would be false. An
 * included round says nothing — there is no charge to warn about.
 *
 * WHAT IS DELIBERATELY NOT HERE: no "What you asked for" readback (decided
 * 2026-09-02). The new version is what the client is here to look at; the
 * deck's Updated rows do not list the readback and it is not improvised.
 *
 * Mauve left rule — the "something changed here, and it needs you" register
 * the queue's banners use, distinct from the forest "with Kelsey" rule of the
 * locked state and the green rule of the approved one.
 */
export function UpdatedState({ round, note, smallPrint }: UpdatedStateProps) {
  const trimmedNote = note?.trim() ?? "";

  return (
    <div style={panelStyle}>
      <div style={titleRowStyle}>
        <h2 style={titleStyle}>{UPDATED_TITLE}</h2>
        <RoundChip round={round} />
      </div>
      <p style={bodyStyle}>{UPDATED_BODY}</p>

      {trimmedNote.length > 0 && (
        <div style={noteBlockStyle}>
          <h3 style={noteLabelStyle}>{UPDATED_NOTE_LABEL}</h3>
          <p style={noteBodyStyle}>{trimmedNote}</p>
        </div>
      )}

      {smallPrint !== null && (
        <p style={smallPrintStyle}>
          {smallPrint === "charge"
            ? UPDATED_SMALL_PRINT_CHARGE
            : UPDATED_SMALL_PRINT_COVERED}
        </p>
      )}
    </div>
  );
}

const panelStyle: CSSProperties = {
  marginBottom: 16,
  border: "1px solid var(--border)",
  borderLeft: "3px solid var(--accent)",
  backgroundColor: "var(--surface-raised)",
  padding: "18px 20px",
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-playfair), serif",
  fontSize: 20,
  fontWeight: 500,
  color: "var(--text-primary)",
};

const bodyStyle: CSSProperties = {
  margin: "8px 0 0",
  maxWidth: "58ch",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-body)",
};

const noteBlockStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const noteLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const noteBodyStyle: CSSProperties = {
  margin: "6px 0 0",
  maxWidth: "58ch",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-primary)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

// Small print: the deck's own name for it. Smaller and muted, but the full
// sentence — it is the one place on this screen that mentions money, and it
// must be readable, not fine print in the legal sense.
const smallPrintStyle: CSSProperties = {
  margin: "14px 0 0",
  maxWidth: "58ch",
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--text-muted)",
};
