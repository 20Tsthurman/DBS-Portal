"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  applyFocus,
  clearFocus,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import {
  confirmShoot,
  declineShootRequest,
} from "@/app/owner/shoots/_actions";

interface PendingRequestActionsProps {
  shootId: string;
  /** Used in the confirmation prompts so the owner sees what they're acting on. */
  clientName: string;
  /** Pre-formatted human label (e.g. "Tue, May 19 · 9:00 AM"). */
  whenLabel: string;
  /** Optional size variant — "sm" is for the calendar pending bar; the panel
   *  uses default size so the action bar reads as the primary CTA. */
  size?: "sm" | "md";
  /** Optional hook fired after the server action succeeds and the page has
   *  been asked to refresh. Used by the edit panel to close itself. */
  onSuccess?: () => void;
}

type PendingAction = "confirm" | "decline";

/** Mirrors MAX_DECLINE_REASON in app/owner/shoots/_actions.ts. */
const MAX_REASON = 500;

export function PendingRequestActions({
  shootId,
  clientName,
  whenLabel,
  size = "sm",
  onSuccess,
}: PendingRequestActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeDialog = () => {
    setPending(null);
    setReason("");
  };

  const runAction = async () => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    const result =
      pending === "confirm"
        ? await confirmShoot(shootId)
        : await declineShootRequest(shootId, reason);
    setBusy(false);

    if (!result.ok) {
      setError(
        result.error ?? `Failed to ${pending} shoot.`
      );
      closeDialog();
      return;
    }

    closeDialog();
    router.refresh();
    onSuccess?.();
  };

  const confirmStyle = size === "md" ? confirmBtnMd : confirmBtnSm;
  const declineStyle = size === "md" ? declineBtnMd : declineBtnSm;
  const stackDir: CSSProperties["flexDirection"] = "row";

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", flexDirection: stackDir, gap: 8 }}>
          <button
            type="button"
            onClick={() => setPending("confirm")}
            disabled={busy}
            style={{
              ...confirmStyle,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setPending("decline")}
            disabled={busy}
            style={{
              ...declineStyle,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Decline
          </button>
        </div>
        {error && <p style={errorStyle}>{error}</p>}
      </div>

      {pending === "confirm" && (
        <ConfirmDialog
          open
          onCancel={() => {
            if (busy) return;
            closeDialog();
          }}
          onConfirm={runAction}
          busy={busy}
          title="Confirm shoot request?"
          body={
            <>
              {clientName} requested a shoot on <strong>{whenLabel}</strong>.
              They&apos;ll see it as confirmed on their calendar.
            </>
          }
          confirmLabel="Confirm shoot"
          variant="success"
        />
      )}

      {pending === "decline" && (
        <ConfirmDialog
          open
          onCancel={() => {
            if (busy) return;
            closeDialog();
          }}
          onConfirm={runAction}
          busy={busy}
          title="Decline shoot request?"
          body={
            <DeclineBody
              clientName={clientName}
              whenLabel={whenLabel}
              reason={reason}
              onReasonChange={setReason}
              disabled={busy}
            />
          }
          confirmLabel="Decline request"
          cancelLabel="Never mind"
          variant="danger"
        />
      )}
    </>
  );
}

interface DeclineBodyProps {
  clientName: string;
  whenLabel: string;
  reason: string;
  onReasonChange: (next: string) => void;
  disabled: boolean;
}

/**
 * The decline dialog carries a note field because a decline the client can
 * see with no explanation ("Kelsey said no, no idea why") is barely better
 * than the silent disappearance this replaced. Optional, though — a decline
 * with no note still reads as an answer on the client's side.
 */
function DeclineBody({
  clientName,
  whenLabel,
  reason,
  onReasonChange,
  disabled,
}: DeclineBodyProps): ReactNode {
  const fieldId = useId();
  const remaining = MAX_REASON - reason.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0 }}>
        {clientName}&apos;s request for <strong>{whenLabel}</strong> will be
        declined. They&apos;ll see it marked declined on their calendar,
        along with anything you write below.
      </p>

      <div>
        <label htmlFor={fieldId} style={labelStyle}>
          Note to {clientName} <span style={optionalStyle}>(optional)</span>
        </label>
        <textarea
          id={fieldId}
          rows={3}
          maxLength={MAX_REASON}
          value={reason}
          disabled={disabled}
          onChange={(e) => onReasonChange(e.target.value)}
          onFocus={applyFocus}
          onBlur={clearFocus}
          placeholder="Booked that morning — Thursday afternoon is wide open."
          style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
        />
        <p style={helperStyle}>
          {reason.trim()
            ? `${remaining} character${remaining === 1 ? "" : "s"} left`
            : "Leave blank to decline without a note."}
        </p>
      </div>
    </div>
  );
}

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "inherit",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  whiteSpace: "nowrap",
};

const confirmBtnSm: CSSProperties = {
  ...buttonBase,
  padding: "6px 12px",
  fontSize: 11,
  backgroundColor: "var(--status-success)",
  color: "#FFFFFF",
  border: "1px solid var(--status-success)",
};

const declineBtnSm: CSSProperties = {
  ...buttonBase,
  padding: "6px 12px",
  fontSize: 11,
  backgroundColor: "transparent",
  color: "var(--status-danger)",
  border: "1px solid var(--status-danger)",
};

const confirmBtnMd: CSSProperties = {
  ...buttonBase,
  flex: 1,
  padding: "10px 16px",
  fontSize: 12,
  backgroundColor: "var(--status-success)",
  color: "#FFFFFF",
  border: "1px solid var(--status-success)",
};

const declineBtnMd: CSSProperties = {
  ...buttonBase,
  flex: 1,
  padding: "10px 16px",
  fontSize: 12,
  backgroundColor: "transparent",
  color: "var(--status-danger)",
  border: "1px solid var(--status-danger)",
};

const errorStyle: CSSProperties = {
  color: "var(--status-danger)",
  fontSize: 11,
  margin: 0,
};

const optionalStyle: CSSProperties = {
  textTransform: "none",
  letterSpacing: "normal",
  fontWeight: 400,
};
