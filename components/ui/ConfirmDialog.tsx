"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";

export type ConfirmDialogVariant = "default" | "danger" | "success";

interface ConfirmDialogProps {
  open: boolean;
  /** Fired when the user dismisses (X, backdrop click, Escape, or Cancel button). */
  onCancel: () => void;
  /** Fired when the user clicks the primary confirm button. */
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** Pass `null` to hide the cancel button (use for info / alert dialogs with a single OK action). */
  cancelLabel?: string | null;
  variant?: ConfirmDialogVariant;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmStyle: CSSProperties = {
    ...confirmBtnBase,
    backgroundColor: confirmBg(variant),
    border: `1px solid ${confirmBg(variant)}`,
  };

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
        aria-labelledby="confirm-dialog-title"
        style={cardStyle}
      >
        <h2 id="confirm-dialog-title" style={titleStyle}>
          {title}
        </h2>
        <div style={bodyStyle}>{body}</div>
        <div style={footerStyle}>
          {cancelLabel !== null && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              style={{
                ...cancelBtnStyle,
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              ...confirmStyle,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

function confirmBg(variant: ConfirmDialogVariant): string {
  switch (variant) {
    case "danger":
      return "var(--status-danger)";
    case "success":
      return "var(--status-success)";
    case "default":
    default:
      return "var(--accent)";
  }
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
  width: "100%",
  maxWidth: 440,
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
  borderTop: "3px solid var(--accent)",
  padding: 24,
  zIndex: 101,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 20,
  fontWeight: 500,
  color: "var(--text-primary)",
  letterSpacing: "-0.01em",
  margin: 0,
};

const bodyStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-body)",
  lineHeight: 1.5,
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 8,
};

const buttonBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const cancelBtnStyle: CSSProperties = {
  ...buttonBase,
  backgroundColor: "transparent",
  color: "var(--text-body)",
  border: "1px solid var(--border)",
};

const confirmBtnBase: CSSProperties = {
  ...buttonBase,
  color: "#FFFFFF",
};
