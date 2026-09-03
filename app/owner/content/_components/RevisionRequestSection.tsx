"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  applyFocus,
  clearFocus,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import {
  acceptRevisionAction,
  denyRevisionAction,
  fetchRevisionRequestAction,
} from "../_actions";
import type { RevisionRequestView } from "../_lib/revisionRequests";
import type { StagedReplacement } from "../_lib/replacementState";
import { ReplacementSection } from "./ReplacementSection";

interface RevisionRequestSectionProps {
  itemId: string;
  /** Fetch only while the panel is up — reopening re-reads, so a request the
   * client submitted while the panel sat closed appears on the next open. */
  open: boolean;
  /** True when the board's item snapshot says a request should exist —
   * governs whether a failed fetch is worth an error line. */
  expectRequest: boolean;
  /**
   * Fired after a resolution lands — an accept may have swapped the item's
   * live media, so the parent refreshes what it owns (the preview strip, the
   * server tree). This component only reloads its own request.
   */
  onResolved?: () => void;
}

/**
 * Whether Accept may run, and with what. `swap` names the staged row that
 * will be activated; a null `reason` on a disabled gate means "still
 * loading", which is not worth a sentence on screen.
 */
function acceptGateFor(
  staged: StagedReplacement[] | null
): { ok: boolean; reason: string | null; swap: StagedReplacement | null } {
  if (staged === null) return { ok: false, reason: null, swap: null };
  if (staged.length > 1) {
    return {
      ok: false,
      reason: "Two replacements exist — remove one first.",
      swap: null,
    };
  }
  const only = staged[0] ?? null;
  if (!only) return { ok: true, reason: null, swap: null };
  if (only.targetAssetId === null) {
    return {
      ok: false,
      reason: "Remove the leftover replacement first.",
      swap: null,
    };
  }
  if (only.status === "failed") {
    return {
      ok: false,
      reason: "The new version failed to encode — remove it first.",
      swap: null,
    };
  }
  if (only.status === "processing") {
    return {
      ok: false,
      reason: "The new version is still processing.",
      swap: null,
    };
  }
  return { ok: true, reason: null, swap: only };
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
 *
 * PHASE 6 attaches the accept workflow here: while the round is OPEN, the
 * replacement upload and side-by-side compare render under the notes
 * (`ReplacementSection`). A resolved round — addressed or denied — shows the
 * request as a record, with no controls.
 */
export function RevisionRequestSection({
  itemId,
  open,
  expectRequest,
  onResolved,
}: RevisionRequestSectionProps) {
  const [request, setRequest] = useState<RevisionRequestView | null>(null);
  const [failed, setFailed] = useState(false);
  /** Staged rows, reported up by ReplacementSection. Null until it loads. */
  const [staged, setStaged] = useState<StagedReplacement[] | null>(null);
  const [note, setNote] = useState("");
  const [confirmingAccept, setConfirmingAccept] = useState(false);
  const [confirmingDeny, setConfirmingDeny] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [denying, setDenying] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

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
    setStaged(null);
    setNote("");
    setConfirmingAccept(false);
    setConfirmingDeny(false);
    setResolveError(null);
    void load();
  }, [open, load]);

  const gate = acceptGateFor(staged);
  const busy = accepting || denying;

  /**
   * Deny's own gate. The written reason is the note field — required here,
   * optional on accept (one field, two meanings, both rendered to the client
   * as "A note from Kelsey"). A staged replacement blocks deny outright:
   * "keeping it as planned" with a new version uploaded is a contradiction,
   * and the action refuses it server-side too.
   */
  const stagedExists = (staged?.length ?? 0) > 0;
  const denyReady =
    staged !== null && !stagedExists && note.trim().length > 0;

  const handleAccept = async () => {
    if (busy || !request) return;
    setResolveError(null);
    setAccepting(true);
    const result = await acceptRevisionAction({
      roundId: request.roundId,
      stagedAssetId: gate.swap?.assetId ?? null,
      note,
    });
    setAccepting(false);
    setConfirmingAccept(false);
    if (!result.ok) {
      // Where a refused Stream delete lands (the accept aborts with nothing
      // written) — in front of Kelsey, with the retry being the same button.
      setResolveError(result.error ?? "Could not accept the request");
      return;
    }
    setNote("");
    await load();
    onResolved?.();
  };

  const handleDeny = async () => {
    if (busy || !request) return;
    setResolveError(null);
    setDenying(true);
    const result = await denyRevisionAction({
      roundId: request.roundId,
      reason: note,
    });
    setDenying(false);
    setConfirmingDeny(false);
    if (!result.ok) {
      setResolveError(result.error ?? "Could not deny the request");
      return;
    }
    setNote("");
    await load();
    onResolved?.();
  };

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

      {request.status === "open" && (
        <>
          <ReplacementSection
            itemId={itemId}
            open={open}
            onReplacementChange={setStaged}
          />

          {/* ---- Accept / deny (slices 6.2, 6.3) ------------------------ */}
          <div style={acceptBlockStyle}>
            <label htmlFor="rvn-note" style={labelStyle}>
              A note for the client
            </label>
            <textarea
              id="rvn-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
            />
            <p style={helperStyle}>
              Optional when accepting. Required to deny — the client sees it
              as &ldquo;A note from Kelsey.&rdquo;
            </p>

            <div style={acceptRowStyle}>
              <button
                type="button"
                onClick={() => setConfirmingAccept(true)}
                disabled={!gate.ok || busy}
                style={{
                  ...acceptButtonStyle,
                  opacity: gate.ok && !busy ? 1 : 0.5,
                  cursor: gate.ok && !busy ? "pointer" : "not-allowed",
                }}
              >
                Accept request
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDeny(true)}
                disabled={!denyReady || busy}
                style={{
                  ...denyButtonStyle,
                  opacity: denyReady && !busy ? 1 : 0.5,
                  cursor: denyReady && !busy ? "pointer" : "not-allowed",
                }}
              >
                Deny request
              </button>
              {gate.reason && <span style={gateReasonStyle}>{gate.reason}</span>}
              {!gate.reason && stagedExists && (
                <span style={gateReasonStyle}>
                  Remove the new version before denying.
                </span>
              )}
            </div>

            {resolveError && (
              <p role="alert" style={errorTextStyle}>
                {resolveError}
              </p>
            )}
          </div>

          <ConfirmDialog
            open={confirmingAccept}
            title="Accept this request?"
            body={
              gate.swap
                ? "The new version replaces the current video, and the old video is deleted from Cloudflare. The client sees the update when you re-release the month."
                : "No new version is attached — the post keeps its current media and the request is marked addressed. Caption or schedule edits you've made are already saved."
            }
            confirmLabel={accepting ? "Accepting…" : "Accept request"}
            cancelLabel="Go back"
            variant="success"
            busy={accepting}
            onConfirm={() => void handleAccept()}
            onCancel={() => {
              if (!accepting) setConfirmingAccept(false);
            }}
          />

          <ConfirmDialog
            open={confirmingDeny}
            title="Deny this request?"
            body="The client sees your note as the reason, and the post stays as planned. A denied request can't be reopened."
            confirmLabel={denying ? "Denying…" : "Deny request"}
            cancelLabel="Go back"
            variant="danger"
            busy={denying}
            onConfirm={() => void handleDeny()}
            onCancel={() => {
              if (!denying) setConfirmingDeny(false);
            }}
          />
        </>
      )}

      {/* A resolved request is a record, not a workspace: the marker and
          Kelsey's own words, nothing pressable. */}
      {request.status !== "open" && (
        <div style={resolvedBlockStyle}>
          <p
            style={
              request.status === "addressed"
                ? resolvedLabelStyle
                : deniedLabelStyle
            }
          >
            {request.status === "addressed" ? "Accepted" : "Denied"}
          </p>
          {request.resolutionNote && (
            <p style={noteBodyStyle}>{request.resolutionNote}</p>
          )}
        </div>
      )}
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

const acceptBlockStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const acceptRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  marginTop: 10,
};

const acceptButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 16px",
  backgroundColor: "var(--status-success)",
  border: "1px solid var(--status-success)",
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

const denyButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 16px",
  backgroundColor: "transparent",
  border: "1px solid var(--status-danger)",
  color: "var(--status-danger)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

const gateReasonStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

const resolvedBlockStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const resolvedLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--status-success)",
};

const deniedLabelStyle: CSSProperties = {
  ...resolvedLabelStyle,
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
