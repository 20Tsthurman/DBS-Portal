import type { CSSProperties } from "react";
import type { RevisionNoteRecord } from "@/lib/supabase";
import {
  CATEGORY_COPY,
  CATEGORY_ORDER,
  SENT_NOTES_HEADING,
  WITH_KELSEY_TITLE,
  withKelseyBody,
} from "../_lib/copy";
import { formatTimecode } from "../_lib/format";

interface WithKelseyStateProps {
  /** "Saturday, September 19" — when they sent it. */
  sentLabel: string;
  /** Every note in the submitted round, as stored. Partitioned here. */
  notes: RevisionNoteRecord[];
}

/**
 * The locked state of a post whose changes were sent (copy deck Screen 5,
 * "With Kelsey"), with the sent-notes readback under "What you asked for".
 *
 * NO ACTIONS AND NO MESSAGE LINK, on purpose. A submitted item is closed
 * (spec §5.4) and stays closed — no reopen, no add-more, and no "Send Kelsey
 * a message" here: that escape hatch lives on the cycle-level working state
 * ONLY (spec §5.6), because repeated on every locked post it becomes the
 * feedback side-channel the per-item lock exists to prevent. The readback is
 * the point of this panel: the client can always see exactly what they asked
 * for, which is what makes the lock feel like a receipt instead of a wall.
 *
 * PARTITION BEFORE GROUPING — the standing rule from `fetchMySubmittedRound`:
 * a note with `timestamp_seconds` is a note on a moment (its stored category
 * is the constant 'other' and means nothing), so moments split out FIRST,
 * then category notes render in deck order and moments chronologically. The
 * timecode chip is bare — "0:12", no preposition (deck decision 2026-08-31).
 */
export function WithKelseyState({ sentLabel, notes }: WithKelseyStateProps) {
  const categoryNotes = notes.filter((n) => n.timestamp_seconds === null);
  const momentNotes = notes
    .filter((n) => n.timestamp_seconds !== null)
    .sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));

  const orderedCategoryNotes = [...categoryNotes].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );

  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{WITH_KELSEY_TITLE}</h2>
      <p style={bodyStyle}>{withKelseyBody(sentLabel)}</p>

      {notes.length > 0 && (
        <div style={readbackStyle}>
          <h3 style={headingStyle}>{SENT_NOTES_HEADING}</h3>

          {orderedCategoryNotes.map((note) => (
            <div key={note.id} style={noteStyle}>
              <p style={noteLabelStyle}>{CATEGORY_COPY[note.category].label}</p>
              <p style={noteBodyStyle}>{note.body}</p>
            </div>
          ))}

          {momentNotes.map((note) => (
            <div key={note.id} style={noteStyle}>
              <span style={timecodeChipStyle}>
                {formatTimecode(note.timestamp_seconds ?? 0)}
              </span>
              <p style={noteBodyStyle}>{note.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const panelStyle: CSSProperties = {
  border: "1px solid var(--border)",
  // Forest left rule — the calm "with Kelsey" register, matching the forest
  // chips: settled from the client's side, in motion on Kelsey's.
  borderLeft: "3px solid #1B3827",
  backgroundColor: "var(--surface-raised)",
  padding: "18px 20px",
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

const readbackStyle: CSSProperties = {
  marginTop: 16,
  paddingTop: 14,
  borderTop: "1px solid var(--border)",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const noteStyle: CSSProperties = {
  marginTop: 12,
};

const noteLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const noteBodyStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-body)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const timecodeChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  backgroundColor: "#1B3827",
  color: "#F2EDE4",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
};
