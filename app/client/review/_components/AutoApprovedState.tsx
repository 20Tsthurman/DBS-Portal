import Link from "next/link";
import type { CSSProperties } from "react";
import { AUTO_FOOTER, AUTO_TITLE, autoBody } from "../_lib/copy";

interface AutoApprovedStateProps {
  /** "October" — bare, for "Reviews for October ended". */
  monthName: string;
  /** "Friday, September 25" — the day reviews closed (`locked_at`). */
  endedLabel: string;
  /** "October 27" — when it goes out. Bare, per the deck. */
  goesOutLabel: string;
}

/**
 * A post the lock approved because the client never got to it (copy deck
 * Screen 5, "Auto"; spec §5.7). Reads as an explanation, not a verdict: the
 * rule the client agreed to, applied, with the send date and a way to ask.
 *
 * SAME GREEN RULE AS `ApprovedState`. In the queue this post carries the
 * Approved pill with "Approved automatically" as its meta — approved is the
 * state, and who approved it is the smaller fact — so the two panels share
 * the settled register rather than this one reading as a warning.
 *
 * NO NEXT POST · ALL POSTS PAIR. The deck lists title, body and footer for
 * this state and nothing else; the page's back link is the way out. The
 * footer's "Send Kelsey a message" is a link to Messages, the same treatment
 * the declined state gives the phrase.
 */
export function AutoApprovedState({
  monthName,
  endedLabel,
  goesOutLabel,
}: AutoApprovedStateProps) {
  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{AUTO_TITLE}</h2>
      <p style={bodyStyle}>{autoBody(monthName, endedLabel, goesOutLabel)}</p>
      <p style={footerStyle}>
        {AUTO_FOOTER.beforeLink}
        <Link href="/client/messages" style={linkStyle}>
          {AUTO_FOOTER.linkText}
        </Link>
      </p>
    </div>
  );
}

const panelStyle: CSSProperties = {
  border: "1px solid var(--border)",
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

const footerStyle: CSSProperties = {
  margin: "12px 0 0",
  fontSize: 14,
  color: "var(--text-body)",
};

const linkStyle: CSSProperties = {
  color: "var(--accent)",
  fontWeight: 600,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};
