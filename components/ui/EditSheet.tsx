"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

interface EditSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onSave: () => void | Promise<void>;
  /** When provided, a trash icon renders in the sheet header. */
  onDelete?: () => void;
  saveLabel?: string;
  isSaving?: boolean;
  /** Disables the Save button (e.g. when required fields are empty). */
  saveDisabled?: boolean;
  /** Optional error message rendered between the body and the footer. */
  error?: string | null;
}

/**
 * Bottom sheet primitive. Renders below `lg` for mobile editing flows.
 *
 * The DOM stays mounted; transforms drive the slide-up / slide-down animation
 * so a parent setting `open=false` gets a smooth exit without managing
 * unmount timing. Backdrop tap, X button, and Cancel button all call
 * `onClose` — the parent owns the open state.
 */
export function EditSheet({
  open,
  onClose,
  title,
  children,
  onSave,
  onDelete,
  saveLabel = "Save",
  isSaving = false,
  saveDisabled = false,
  error,
}: EditSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Scroll-lock the body while the sheet is open. The cleanup restores
  // whatever value was there (a previous modal might also be locking).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isSaving, onClose]);

  // Focus the sheet container when opened so screen readers and Esc work
  // immediately. Avoid stealing focus from a first form field — the parent
  // should rely on the user to tap into the field they want.
  useEffect(() => {
    if (open) sheetRef.current?.focus();
  }, [open]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={() => {
          if (!isSaving) onClose();
        }}
        style={{
          ...backdropStyle,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-sheet-title"
        aria-hidden={!open}
        tabIndex={-1}
        style={{
          ...sheetStyle,
          transform: open ? "translateY(0)" : "translateY(100%)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div style={handleWrapStyle}>
          <div aria-hidden="true" style={handleStyle} />
        </div>

        <div style={headerStyle}>
          <h2 id="edit-sheet-title" style={titleStyle}>
            {title}
          </h2>
          <div style={headerActionsStyle}>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete"
                disabled={isSaving}
                style={iconButtonStyle}
              >
                <TrashIcon />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              disabled={isSaving}
              style={iconButtonStyle}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div style={bodyStyle}>{children}</div>

        {error && (
          <div role="alert" style={errorBannerStyle}>
            {error}
          </div>
        )}

        <div style={footerStyle}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            style={{
              ...cancelButtonStyle,
              opacity: isSaving ? 0.6 : 1,
              cursor: isSaving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isSaving && !saveDisabled) void onSave();
            }}
            disabled={isSaving || saveDisabled}
            style={{
              ...saveButtonStyle,
              opacity: isSaving || saveDisabled ? 0.6 : 1,
              cursor: isSaving || saveDisabled ? "not-allowed" : "pointer",
            }}
          >
            {isSaving && <Spinner />}
            <span>{isSaving ? "Saving…" : saveLabel}</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Form field primitives — shared dimensions so every sheet input gets 48px
// height + 16px font-size (suppresses iOS zoom on focus). Exported so card
// lists can compose forms without duplicating the styling.
// ---------------------------------------------------------------------------

interface SheetFieldProps {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  /** Right-side hint shown next to the label (e.g. "Optional"). */
  hint?: string;
}

export function SheetField({ label, htmlFor, children, hint }: SheetFieldProps) {
  return (
    <div style={fieldWrapStyle}>
      <div style={fieldLabelRowStyle}>
        <label htmlFor={htmlFor} style={fieldLabelStyle}>
          {label}
        </label>
        {hint && <span style={fieldHintStyle}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export const sheetInputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: 48,
  boxSizing: "border-box",
  padding: "0 14px",
  fontSize: 16,
  fontFamily: "inherit",
  color: "var(--text-primary)",
  backgroundColor: "#FFFFFF",
  border: "1px solid var(--border)",
  outline: "none",
};

export const sheetTextareaStyle: CSSProperties = {
  ...sheetInputStyle,
  height: 96,
  paddingTop: 12,
  paddingBottom: 12,
  resize: "vertical",
  lineHeight: 1.4,
};

export const sheetReadonlyStyle: CSSProperties = {
  ...sheetInputStyle,
  display: "flex",
  alignItems: "center",
  backgroundColor: "var(--surface-base)",
  color: "var(--text-body)",
};

// ---------------------------------------------------------------------------
// Local icons + spinner. Kept inline so this file has no new imports.
// ---------------------------------------------------------------------------

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        marginRight: 8,
        border: "2px solid rgba(255,255,255,0.4)",
        borderTopColor: "#FFFFFF",
        animation: "edit-sheet-spin 0.7s linear infinite",
      }}
    >
      <style>{`
        @keyframes edit-sheet-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.5)",
  zIndex: 60,
  transition: "opacity 200ms ease-out",
};

const sheetStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 61,
  maxHeight: "75vh",
  display: "flex",
  flexDirection: "column",
  backgroundColor: "var(--surface-raised)",
  borderTop: "1px solid var(--border)",
  transition: "transform 200ms ease-out",
  outline: "none",
};

const handleWrapStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  display: "flex",
  justifyContent: "center",
  padding: "8px 0 4px",
  backgroundColor: "var(--surface-raised)",
};

const handleStyle: CSSProperties = {
  width: 40,
  height: 4,
  backgroundColor: "var(--border)",
};

const headerStyle: CSSProperties = {
  position: "sticky",
  top: 12,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 16px 12px",
  backgroundColor: "var(--surface-raised)",
  borderBottom: "1px solid var(--border)",
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 20,
  fontWeight: 500,
  color: "var(--text-primary)",
  letterSpacing: "-0.01em",
  margin: 0,
};

const headerActionsStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const iconButtonStyle: CSSProperties = {
  width: 44,
  height: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "transparent",
  border: "none",
  color: "var(--text-body)",
  cursor: "pointer",
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const errorBannerStyle: CSSProperties = {
  padding: "10px 16px",
  color: "var(--status-danger)",
  backgroundColor: "rgba(122,48,64,0.08)",
  borderTop: "1px solid var(--status-danger)",
  fontSize: 13,
};

const footerStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  display: "flex",
  gap: 8,
  padding: 16,
  backgroundColor: "var(--surface-raised)",
  borderTop: "1px solid var(--border)",
};

const baseFooterButton: CSSProperties = {
  flex: 1,
  height: 48,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontFamily: "inherit",
};

const cancelButtonStyle: CSSProperties = {
  ...baseFooterButton,
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-body)",
};

const saveButtonStyle: CSSProperties = {
  ...baseFooterButton,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
};

const fieldWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const fieldLabelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  fontWeight: 600,
};

const fieldHintStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  fontStyle: "italic",
};
