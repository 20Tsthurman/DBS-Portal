"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { fetchRevisionRequestAction } from "../_actions";
import type { RevisionRequestView } from "../_lib/revisionRequests";

interface RevisionRequestSectionProps {
  itemId: string;
  /** Fetch only while the panel is up — reopening re-reads, so a request the
   * client submitted while the panel sat closed appears on the next open. */
  open: boolean;
  /** True when the board's item snapshot says a request should exist —
   * governs whether a failed fetch is worth an error line. */
  expectRequest: boolean;
}

/**
 * What the client asked for, read-only, at the top of the item panel
 * (Phase 5, slice 5.3).
 *
 * NO ACCEPT, NO DENY, NO CONTROLS — spec §4.7: seeing a request does not
 * obligate Kelsey to act on it, and acting is Phase 6. This block is her
 * reading surface: categories with comments in the form's fixed order, then
 * moment notes with their timecodes.
 *
 * Fetches on open for ANY existing item and renders nothing when there is no
 * submitted request. That sidesteps the board's snapshot problem (the panel's
 * `item` is captured at open; a request submitted after the board's last
 * refresh would be invisible to a status-gated render) — the fetch is live
 * even when the snapshot is stale. The empty case costs one indexed
 * single-row query per panel open.
 *
 * A fetch failure shows an error only when the snapshot says a request
 * exists; otherwise there is probably nothing to show and an error line
 * would cry wolf on every flaky open. The row's "Changes requested" pill and
 * the rollup count mean a silently-failed load here is never the only signal.
 */
export function RevisionRequestSection({
  itemId,
  open,
  expectRequest,
}: RevisionRequestSectionProps) {
  const [request, setRequest] = useState<RevisionRequestView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const result = await fetchRevisionRequestAction(itemId);
    if (!result.ok) {
      setRequest(null);
      setFailed(true);
      return;
    }
    setRequest(result.data ?? null);
  }, [itemId]);

  useEffect(() => {
    if (!open) return;
    setRequest(null);
    void load();
  }, [open, load]);

  if (failed && expectRequest) {
    return (
      <div style={blockStyle}>
        <p role="alert" style={errorTextStyle}>
          Couldn&apos;t load the change request.
        </p>
        <button type="button" onClick={() => void load()} style={retryStyle}>
          Try again
        </button>
      </div>
    );
  }

  if (!request) return null;

  return (
    <div style={blockStyle}>
      <p style={headingStyle}>Change request</p>
      <p style={metaStyle}>
        Round {request.roundNumber} · Sent {request.sentLabel}
      </p>

      {request.notes.map((note) => (
        <div key={note.id} style={noteStyle}>
          {note.categoryLabel !== null ? (
            <p style={noteLabelStyle}>{note.categoryLabel}</p>
          ) : (
            <span style={timecodeChipStyle}>{note.timecode}</span>
          )}
          <p style={noteBodyStyle}>{note.body}</p>
        </div>
      ))}
    </div>
  );
}

const blockStyle: CSSProperties = {
  border: "1px solid var(--border)",
  // Mauve rule — the same "something changed here" accent the rollup's
  // "Changes requested" count carries.
  borderLeft: "3px solid var(--accent)",
  backgroundColor: "var(--surface-base)",
  padding: "14px 16px",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const metaStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "var(--text-muted)",
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
  fontSize: 13,
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

const errorTextStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--status-danger)",
};

const retryStyle: CSSProperties = {
  marginTop: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 40,
  padding: "0 14px",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "inherit",
  cursor: "pointer",
};
