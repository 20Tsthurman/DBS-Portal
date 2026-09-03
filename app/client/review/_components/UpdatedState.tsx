import type { CSSProperties } from "react";
import { RoundChip } from "./RoundChip";
import { UPDATED_BODY, UPDATED_NOTE_LABEL, UPDATED_TITLE } from "../_lib/copy";

interface UpdatedStateProps {
  /** The post's `current_round` after re-release — 2 or more, so the chip shows. */
  round: number;
  /**
   * Kelsey's optional note on the accept (`revision_rounds.resolution_note`).
   * Null, or empty, when she attached none — the label block is omitted rather
   * than rendered over nothing.
   */
  note: string | null;
}

/**
 * The updated state (copy deck Screen 5, "Updated"): a post that came back
 * after a re-release, open for review again at round 2 or later. Renders
 * ABOVE the Screen 2 actions — the same Approve / Request changes pair — so
 * the client reads what happened, then decides.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   - The deck's "Updated — small print" ("Another round of changes has a
 *     charge — you'll always see the amount before anything is sent") is HELD
 *     until Phase 8. Before the consent dialog exists a round-2+ request
 *     carries no charge, so the sentence would be untrue in front of the
 *     client. `_lib/copy.ts` has no export for it on purpose.
 *   - No "What you asked for" readback (decided 2026-09-02). The new version
 *     is what the client is here to look at; the deck's Updated rows do not
 *     list the readback and it is not improvised.
 *
 * Mauve left rule — the "something changed here, and it needs you" register
 * the queue's banners use, distinct from the forest "with Kelsey" rule of the
 * locked state and the green rule of the approved one.
 */
export function UpdatedState({ round, note }: UpdatedStateProps) {
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
