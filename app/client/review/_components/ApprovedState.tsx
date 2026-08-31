import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ACTION_NEXT_POST,
  APPROVED_TITLE,
  BACK_LINK,
  approvedBody,
} from "../_lib/copy";

interface ApprovedStateProps {
  /** "Saturday, September 19" - when they approved it. */
  approvedLabel: string;
  /** "October 10" - when it goes out. Bare, per the deck. */
  goesOutLabel: string;
  /** Href of the next post in the queue, or null on the last one. */
  nextHref: string | null;
}

/**
 * What replaces the actions once a post is approved (copy deck Screen 5).
 *
 * NEXT POST IS HIDDEN ON THE LAST POST rather than disabled. A dead control at
 * the end of a queue is a small puzzle to solve at the exact moment the client
 * is finished and should feel finished; "All posts" is the honest remaining
 * move, and the queue's own all-handled banner says the rest.
 *
 * "Next post" means the next post in queue order, not the next unreviewed one.
 * The queue is chronological and the position line reads "Post 5 of 12", so
 * next means 6 - jumping from 2 to 9 because 3 through 8 were already handled
 * would contradict the counter on screen.
 */
export function ApprovedState({
  approvedLabel,
  goesOutLabel,
  nextHref,
}: ApprovedStateProps) {
  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{APPROVED_TITLE}</h2>
      <p style={bodyStyle}>{approvedBody(approvedLabel, goesOutLabel)}</p>
      <div style={actionsStyle}>
        {nextHref && (
          <Link href={nextHref} style={primaryActionStyle}>
            {ACTION_NEXT_POST}
          </Link>
        )}
        <Link href="/client/review" style={actionStyle}>
          {BACK_LINK}
        </Link>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  border: "1px solid var(--border)",
  // Green left rule: the same "this is settled" signal the approved pill
  // carries in the queue, so the two read as one state.
  borderLeft: "3px solid var(--status-success)",
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

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginTop: 16,
};

const actionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 18px",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const primaryActionStyle: CSSProperties = {
  ...actionStyle,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
};
