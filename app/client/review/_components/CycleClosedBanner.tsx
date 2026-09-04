import Link from "next/link";
import type { CSSProperties } from "react";
import type { ContentCycleLockedBy } from "@/lib/supabase";
import {
  CLOSED_EARLY_ACTION,
  CLOSED_EARLY_BODY,
  closedEarlyTitle,
  deadlineBody,
  deadlineTitle,
} from "../_lib/copy";

interface CycleClosedBannerProps {
  /**
   * How the month closed (`content_cycles.locked_by`, migration 018): 'auto'
   * for the deadline sweep, 'owner' for Kelsey's Lock now. Null only against
   * a locked row that predates the column — rendered as the deadline close,
   * the path every real lock before Phase 7 could only have been.
   */
  lockedBy: ContentCycleLockedBy | null;
  monthName: string;
  /**
   * "Friday, September 25" — the day reviews actually closed (`locked_at`).
   * Null only alongside a null `lockedBy`; the Closed-early body is the one
   * banner that names no date, so it is what renders then.
   */
  endedLabel: string | null;
  /** Posts the client approved themselves. */
  approvedCount: number;
  /** Posts the lock approved for them. */
  autoCount: number;
}

/**
 * The banner over a closed month's read-only queue (copy deck Screen 6,
 * "Deadline" and "Closed early"; spec §5.6–5.7). Takes the slot the count
 * line and the deadline card held while the month was open — the design
 * boards show the same list under it, pills and all, with nothing left to
 * press.
 *
 * TWO BANNERS, CHOSEN BY `locked_by`, and the difference is the whole
 * reason migration 018 exists. A deadline close says what the deadline did
 * ("3 you hadn't reviewed were approved automatically") and dates it; an
 * early close says Kelsey did it and why, names no date, and offers the
 * conversation instead. Deriving "early" from the deadline would flip the
 * story the morning after the deadline passed.
 *
 * The early banner's action is a link to Messages: the client did not ask
 * for this close, so the one honest next move is to talk to the person who
 * did. The deadline banner has no action — nothing is owed either way.
 */
export function CycleClosedBanner({
  lockedBy,
  monthName,
  endedLabel,
  approvedCount,
  autoCount,
}: CycleClosedBannerProps) {
  const closedEarly = lockedBy === "owner" || endedLabel === null;

  if (closedEarly) {
    return (
      <div style={panelStyle}>
        <h2 style={titleStyle}>{closedEarlyTitle(monthName)}</h2>
        <p style={bodyStyle}>{CLOSED_EARLY_BODY}</p>
        <div style={actionsStyle}>
          <Link href="/client/messages" style={actionStyle}>
            {CLOSED_EARLY_ACTION}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{deadlineTitle(monthName)}</h2>
      <p style={bodyStyle}>
        {deadlineBody({ endedLabel, approvedCount, autoCount })}
      </p>
    </div>
  );
}

const panelStyle: CSSProperties = {
  marginBottom: 16,
  border: "1px solid var(--border)",
  // Mauve rule, like the all-handled banner and the Working state this
  // replaces — "something changed here" reads the same way everywhere.
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

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginTop: 14,
};

const actionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 18px",
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
