"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ApproveDialog } from "./ApproveDialog";
import {
  ACTION_APPROVE,
  ACTION_REQUEST_CHANGES,
  APPROVE_FAILED,
} from "../_lib/copy";
import { approveContentItemAction } from "../_actions";

interface PostActionsProps {
  itemId: string;
  /** "Saturday, October 10" - the dialog names the send date. */
  goesOutLabel: string;
}

/**
 * The two actions on a post awaiting review (copy deck Screen 2).
 *
 * REQUEST CHANGES IS DELIBERATELY INERT IN THIS PHASE. It renders as a real,
 * disabled button with no handler; Phase 5 builds the guided form behind it.
 * It is here rather than hidden so the surface a client learns now is the
 * surface they keep - but until Phase 5 lands, no cycle should be released to
 * a real client, because a dead control with no explanation is exactly the
 * kind of thing this design constraint exists to avoid.
 *
 * There is no approve-all and no global submit anywhere on this surface, in
 * this phase or any later one (spec 5.4). Per-item action is the mechanism the
 * whole round structure rests on.
 */
export function PostActions({ itemId, goesOutLabel }: PostActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setFailed(false);
    setBusy(true);
    const result = await approveContentItemAction(itemId);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      // One message for every failure. The client has the same move in each
      // case - try again - and naming the difference between a network blip
      // and an unreleased cycle would help nobody reading it.
      setFailed(true);
      return;
    }
    router.refresh();
  };

  return (
    <div>
      <div style={rowStyle}>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          style={approveStyle}
        >
          {ACTION_APPROVE}
        </button>
        <button type="button" disabled style={requestStyle}>
          {ACTION_REQUEST_CHANGES}
        </button>
      </div>

      {failed && (
        <p role="alert" style={errorStyle}>
          {APPROVE_FAILED}
        </p>
      )}

      <ApproveDialog
        open={confirming}
        onCancel={() => {
          if (busy) return;
          setConfirming(false);
        }}
        onConfirm={handleConfirm}
        goesOutLabel={goesOutLabel}
        busy={busy}
      />
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
};

const buttonBase: CSSProperties = {
  flex: "1 1 160px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 18px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "inherit",
  cursor: "pointer",
};

/** Green, matching the confirm button the client meets one press later. */
const approveStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "var(--status-success)",
  border: "1px solid var(--status-success)",
  color: "#FFFFFF",
};

const requestStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
  opacity: 0.5,
  cursor: "not-allowed",
};

const errorStyle: CSSProperties = {
  margin: "12px 0 0",
  padding: "10px 12px",
  border: "1px solid var(--status-danger)",
  backgroundColor: "rgba(122,48,64,0.08)",
  color: "var(--status-danger)",
  fontSize: 13,
  lineHeight: 1.5,
};
