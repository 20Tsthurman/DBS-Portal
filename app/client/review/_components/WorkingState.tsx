import Link from "next/link";
import type { CSSProperties } from "react";
import { WORKING_FOOTER, WORKING_TITLE, workingBody } from "../_lib/copy";

interface WorkingStateProps {
  /** How many posts have changes sent — the body names the count. */
  changedCount: number;
}

/**
 * The cycle-level working state (copy deck Screen 6, "Working"): every post
 * is reviewed and at least one has changes sent, so the month is in Kelsey's
 * hands. Supersedes the queue's Phase 4 changes-requested banner in exactly
 * that condition (ruling 2026-08-31); the all-approved banner is untouched.
 *
 * THE ONE ESCAPE HATCH LIVES HERE. "Forgot something? Send Kelsey a message"
 * appears at cycle level, once, and never on an individual locked post —
 * repeated per-post it becomes a feedback side-channel that defeats the
 * per-item lock (spec §5.6). The link goes to Messages, the same treatment
 * every other client surface gives that phrase.
 */
export function WorkingState({ changedCount }: WorkingStateProps) {
  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{WORKING_TITLE}</h2>
      <p style={bodyStyle}>{workingBody(changedCount)}</p>
      <p style={footerStyle}>
        {WORKING_FOOTER.beforeLink}
        <Link href="/client/messages" style={linkStyle}>
          {WORKING_FOOTER.linkText}
        </Link>
      </p>
    </div>
  );
}

const panelStyle: CSSProperties = {
  marginTop: 12,
  marginBottom: 16,
  border: "1px solid var(--border)",
  // Mauve rule, like the banner it supersedes — "something changed here"
  // reads the same way everywhere in the portal.
  borderLeft: "3px solid var(--accent)",
  backgroundColor: "var(--surface-raised)",
  padding: "16px 18px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-playfair), serif",
  fontSize: 18,
  fontWeight: 500,
  color: "var(--text-primary)",
};

const bodyStyle: CSSProperties = {
  margin: "8px 0 0",
  maxWidth: "62ch",
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
};
