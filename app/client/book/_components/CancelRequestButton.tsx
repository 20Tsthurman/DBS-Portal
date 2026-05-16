"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cancelMyShootRequest } from "../_actions";

interface CancelRequestButtonProps {
  shootId: string;
  closeHref: string;
}

export function CancelRequestButton({
  shootId,
  closeHref,
}: CancelRequestButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setBusy(true);
    const result = await cancelMyShootRequest(shootId);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Failed to cancel request.");
      setOpen(false);
      return;
    }

    setOpen(false);
    router.push(closeHref);
    router.refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{
          ...destructiveButtonStyle,
          opacity: busy ? 0.6 : 1,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Cancelling…" : "Cancel request"}
      </button>
      {error && <p style={errorTextStyle}>{error}</p>}

      <ConfirmDialog
        open={open}
        onCancel={() => {
          if (busy) return;
          setOpen(false);
        }}
        onConfirm={handleConfirm}
        busy={busy}
        title="Cancel this shoot request?"
        body="The request will be removed from Kelsey's calendar. You can submit a new one anytime."
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        variant="danger"
      />
    </div>
  );
}

const destructiveButtonStyle: CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  border: "1px solid var(--status-danger)",
  color: "var(--status-danger)",
  backgroundColor: "transparent",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
};

const errorTextStyle: CSSProperties = {
  color: "var(--status-danger)",
  fontSize: 12,
};
