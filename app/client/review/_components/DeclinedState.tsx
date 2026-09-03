import Link from "next/link";
import type { CSSProperties } from "react";
import {
  ACTION_NEXT_POST,
  BACK_LINK,
  DECLINED_LINK_TEXT,
  DECLINED_REASON_LABEL,
  DECLINED_TITLE,
  declinedBodyBeforeLink,
} from "../_lib/copy";

interface DeclinedStateProps {
  /**
   * Kelsey's written reason — REQUIRED on every deny (spec §4.7, enforced by
   * migration 017's constraint), so this is null only against hand-edited
   * data. Guarded anyway: a missing label block beats an empty labelled one.
   */
  reason: string | null;
  /** "October 17" — bare, like the approved state's send date: a plan. */
  goesOutLabel: string;
  /** Href of the next post in the queue, or null on the last one. */
  nextHref: string | null;
}

/**
 * A denied request (copy deck Screen 5, "Declined"). The post is settled —
 * it goes out as planned — so the state reads as an answer, not a wall:
 * Kelsey's reason first, in her own words, then the plan, then the way to
 * talk it through.
 *
 * TWO WAYS OUT, deliberately (deck row added 2026-08-31): the body's "Send
 * Kelsey a message" link for the conversation, and the same "Next post · All
 * posts" pair the approved state has — a declined post is as finished as an
 * approved one, and the client's next move is the rest of the queue. Next
 * post hides on the last post rather than disabling, matching
 * `ApprovedState`'s reasoning.
 *
 * NEUTRAL left rule, not danger: the deck's pill for this state ("Kept as
 * planned") is neutral tone. A red edge would read as an error on a post
 * that is going out exactly as designed.
 */
export function DeclinedState({
  reason,
  goesOutLabel,
  nextHref,
}: DeclinedStateProps) {
  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{DECLINED_TITLE}</h2>

      {reason !== null && (
        <div style={reasonBlockStyle}>
          <h3 style={reasonLabelStyle}>{DECLINED_REASON_LABEL}</h3>
          <p style={reasonBodyStyle}>{reason}</p>
        </div>
      )}

      <p style={bodyStyle}>
        {declinedBodyBeforeLink(goesOutLabel)}
        <Link href="/client/messages" style={messageLinkStyle}>
          {DECLINED_LINK_TEXT}
        </Link>
      </p>

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
  // Neutral rule — settled, not alarming. See the component docblock.
  borderLeft: "3px solid var(--border)",
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

const reasonBlockStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const reasonLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const reasonBodyStyle: CSSProperties = {
  margin: "6px 0 0",
  maxWidth: "58ch",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-primary)",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const bodyStyle: CSSProperties = {
  margin: "12px 0 0",
  maxWidth: "58ch",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-body)",
};

const messageLinkStyle: CSSProperties = {
  color: "var(--accent)",
  fontWeight: 600,
  textDecoration: "underline",
  textUnderlineOffset: 3,
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
