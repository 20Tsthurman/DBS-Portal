"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  APPROVE_DIALOG_CANCEL,
  APPROVE_DIALOG_CONFIRM,
  APPROVE_DIALOG_TITLE,
  approveDialogBody,
} from "../_lib/copy";

interface ApproveDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** "Saturday, October 10" - when the post goes out. */
  goesOutLabel: string;
  busy: boolean;
}

/**
 * The approve confirmation - deliberately NOT `components/ui/ConfirmDialog`.
 *
 * Spec 5.3 and the copy deck both specify this dialog as the LIGHTER of two:
 * no accent bar, a DM Sans title rather than Playfair, a one-line body, and
 * compact buttons. "The weight difference is the signal for which action
 * deserves the longer pause" - and the heavier one is Phase 5's send-feedback
 * dialog, which will use the house `ConfirmDialog` exactly as it is, accent
 * bar and display face included.
 *
 * That difference is the reason this is a separate component instead of two
 * new flags on the shared primitive. `ConfirmDialog`'s 3px mauve top rule and
 * Playfair title are its identity across eight features; making them optional
 * to serve one caller would invite the next caller to switch them off for no
 * reason, and the contrast this design depends on would erode.
 *
 * Behaviour matches `ConfirmDialog` rather than exceeding it: Escape and a
 * backdrop click cancel (both suppressed while busy), `role="dialog"` with
 * `aria-modal`, and no focus trap - the house dialog has none either, and
 * adding one here would make this the odd component out.
 *
 * "Compact buttons" is read as less weight, not a smaller target: they keep
 * the 48px tap floor and lose the padding instead. A confirm button under a
 * thumb is not where the design system gets relaxed.
 */
export function ApproveDialog({
  open,
  onCancel,
  onConfirm,
  goesOutLabel,
  busy,
}: ApproveDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, busy, onCancel]);

  // Focus lands on Confirm, not Cancel. The client pressed Approve to get
  // here; the dialog is a pause, not a warning, and a keyboard user should
  // not have to tab to finish what they started.
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => {
          if (!busy) onCancel();
        }}
        style={backdropStyle}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-dialog-title"
        style={cardStyle}
      >
        <h2 id="approve-dialog-title" style={titleStyle}>
          {APPROVE_DIALOG_TITLE}
        </h2>
        <p style={bodyStyle}>{approveDialogBody(goesOutLabel)}</p>
        <div style={footerStyle}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ ...cancelStyle, opacity: busy ? 0.6 : 1 }}
          >
            {APPROVE_DIALOG_CANCEL}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{ ...confirmStyle, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Working…" : APPROVE_DIALOG_CONFIRM}
          </button>
        </div>
      </div>
    </>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.4)",
  zIndex: 100,
};

const cardStyle: CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "calc(100% - 32px)",
  maxWidth: 380,
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
  // No accent top rule. That bar belongs to the send dialog.
  padding: 20,
  zIndex: 101,
};

const titleStyle: CSSProperties = {
  margin: 0,
  // DM Sans (the body face), not Playfair - the deck's "plain-face title".
  fontSize: 17,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const bodyStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--text-body)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 16px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const cancelStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "transparent",
  color: "var(--text-body)",
  border: "1px solid var(--border)",
};

/** Green, per the deck's "Confirm | Approve post | Green". */
const confirmStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "var(--status-success)",
  border: "1px solid var(--status-success)",
  color: "#FFFFFF",
};
