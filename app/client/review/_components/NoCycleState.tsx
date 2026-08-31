import type { CSSProperties } from "react";
import {
  addMonthsToMonthKey,
  formatMonthLabel,
  monthDayLabelForDateKey,
  monthNameForMonthKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import {
  NOTHING_YET_BODY,
  NOTHING_YET_TITLE,
  RECAP_EYEBROW,
  betweenMonthsBody,
  betweenMonthsTitle,
  recapMeta,
} from "../_lib/copy";

/** The closed month behind the recap card, or null for a client with none. */
export interface RecapSummary {
  /** "YYYY-MM" of the closed cycle. */
  monthKey: string;
  postCount: number;
  /** The cycle's `revision_deadline`, or null if it somehow closed without one. */
  closedAt: string | null;
}

interface NoCycleStateProps {
  recap: RecapSummary | null;
}

/**
 * What a client sees with no month out for review (spec §5.9, copy deck
 * Screen 7).
 *
 * "A client with no active cycle sees a deliberate state, never an empty page
 * or anything that reads as an error." Both variants say the same operative
 * thing — nothing for you to do, an email is coming — and differ only in
 * whether there is finished work to point at.
 */
export function NoCycleState({ recap }: NoCycleStateProps) {
  if (!recap) {
    return (
      <div style={panelStyle}>
        <h2 style={titleStyle}>{NOTHING_YET_TITLE}</h2>
        <p style={bodyStyle}>{NOTHING_YET_BODY}</p>
      </div>
    );
  }

  const monthName = monthNameForMonthKey(recap.monthKey);
  // "When November is ready" — the month after the one that just closed, which
  // is the next one this client will be asked to review.
  const nextMonthName = monthNameForMonthKey(
    addMonthsToMonthKey(recap.monthKey, 1)
  );
  const closedLabel = recap.closedAt
    ? monthDayLabelForDateKey(dateKeyInTimezone(new Date(recap.closedAt)))
    : null;

  return (
    <div style={panelStyle}>
      <h2 style={titleStyle}>{betweenMonthsTitle(monthName)}</h2>
      <p style={bodyStyle}>{betweenMonthsBody(monthName, nextMonthName)}</p>

      <div style={recapCardStyle}>
        <p className="eyebrow" style={{ margin: 0 }}>
          {RECAP_EYEBROW}
        </p>
        <p style={recapMonthStyle}>{formatMonthLabel(recap.monthKey)}</p>
        <p style={recapMetaStyle}>
          {recapMeta(recap.postCount, closedLabel)}
        </p>
      </div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "32px 24px",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-playfair), serif",
  fontSize: 22,
  fontWeight: 500,
  color: "var(--text-primary)",
};

const bodyStyle: CSSProperties = {
  margin: "12px 0 0",
  maxWidth: "58ch",
  fontSize: 15,
  lineHeight: 1.6,
  color: "var(--text-body)",
};

const recapCardStyle: CSSProperties = {
  marginTop: 24,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-base)",
  padding: "16px 18px",
};

const recapMonthStyle: CSSProperties = {
  margin: "6px 0 0",
  fontFamily: "var(--font-playfair), serif",
  fontSize: 18,
  fontWeight: 500,
  color: "var(--text-primary)",
};

const recapMetaStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: "var(--text-muted)",
};
