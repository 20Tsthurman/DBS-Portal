"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cancelShoot, confirmShoot } from "@/app/owner/shoots/_actions";

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

export function PendingRequestActions({
  shootId,
  clientName,
  whenLabel,
  size = "sm",
  onSuccess,
}: PendingRequestActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = async () => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    const result =
      pending === "confirm"
        ? await confirmShoot(shootId)
        : await cancelShoot(shootId);
    setBusy(false);

    if (!result.ok) {
      setError(
        result.error ?? `Failed to ${pending} shoot.`
      );
      setPending(null);
      return;
    }

    setPending(null);
    router.refresh();
    onSuccess?.();
  };

  const dialogProps = pending
    ? buildDialogProps(pending, clientName, whenLabel)
    : null;

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

      {dialogProps && (
        <ConfirmDialog
          open
          onCancel={() => {
            if (busy) return;
            setPending(null);
          }}
          onConfirm={runAction}
          busy={busy}
          {...dialogProps}
        />
      )}
    </>
  );
}

function buildDialogProps(
  action: PendingAction,
  clientName: string,
  whenLabel: string
) {
  if (action === "confirm") {
    return {
      title: "Confirm shoot request?",
      body: (
        <>
          {clientName} requested a shoot on{" "}
          <strong>{whenLabel}</strong>. They&apos;ll see it as confirmed on
          their calendar.
        </>
      ),
      confirmLabel: "Confirm shoot",
      variant: "success" as const,
    };
  }
  return {
    title: "Decline shoot request?",
    body: (
      <>
        {clientName}&apos;s request for <strong>{whenLabel}</strong> will be
        cancelled. They&apos;ll see the cancellation on their calendar.
      </>
    ),
    confirmLabel: "Decline request",
    variant: "danger" as const,
  };
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
