import type { CSSProperties } from "react";
import {
  ALL_HANDLED_TITLE,
  COUNT_ALL_HANDLED,
  allHandledBody,
  countFresh,
  countRemaining,
  reviewedMeta,
} from "../_lib/copy";

interface QueueSummaryProps {
  total: number;
  /** Posts still sitting at 'in_review'. */
  remaining: number;
  hasChangesRequested: boolean;
  monthName: string;
}

/**
 * The line that tells the client where they stand, plus the banner that
 * appears once nothing is left (copy deck Screen 1).
 *
 * Three count states, and the deck writes each one differently on purpose:
 * fresh ("12 posts are ready for your review") invites, partway ("8 posts
 * still need your review") reports, and finished ("Nothing needs you right
 * now") releases. The meta only appears once there is progress to report —
 * "0 of 12 reviewed" beside an invitation is discouraging and says nothing.
 */
export function QueueSummary({
  total,
  remaining,
  hasChangesRequested,
  monthName,
}: QueueSummaryProps) {
  const reviewed = total - remaining;
  const allHandled = remaining === 0;

  const countLine = allHandled
    ? COUNT_ALL_HANDLED
    : reviewed === 0
      ? countFresh(total)
      : countRemaining(remaining);

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p style={countStyle}>{countLine}</p>
        {reviewed > 0 && (
          <p style={metaStyle}>{reviewedMeta(reviewed, total)}</p>
        )}
      </div>

      {allHandled && (
        <div style={bannerStyle}>
          <h2 style={bannerTitleStyle}>{ALL_HANDLED_TITLE}</h2>
          <p style={bannerBodyStyle}>
            {allHandledBody({ total, hasChangesRequested, monthName })}
          </p>
        </div>
      )}
    </div>
  );
}

const countStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  color: "var(--text-primary)",
  fontWeight: 500,
};

const metaStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--text-muted)",
};

const bannerStyle: CSSProperties = {
  marginTop: 12,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  // Mauve rule on the leading edge — the same accent-border language the owner
  // calendar's pills use, so "something changed here" reads the same way on
  // both sides of the portal.
  borderLeft: "3px solid var(--accent)",
  padding: "16px 18px",
};

const bannerTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-playfair), serif",
  fontSize: 18,
  fontWeight: 500,
  color: "var(--text-primary)",
};

const bannerBodyStyle: CSSProperties = {
  margin: "8px 0 0",
  maxWidth: "62ch",
  fontSize: 14,
  lineHeight: 1.6,
  color: "var(--text-body)",
};
