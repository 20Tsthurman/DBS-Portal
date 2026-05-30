import type { CSSProperties } from "react";

export const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "11px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
  marginBottom: 6,
  fontWeight: 600,
};

export const fieldStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  background: "#FFFFFF",
  padding: "8px 12px",
  fontSize: "14px",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  outline: "none",
};

export const fieldFocusStyle: CSSProperties = {
  borderColor: "var(--accent)",
};

// Muted helper copy shown directly below a field's input.
export const helperStyle: CSSProperties = {
  marginTop: 6,
  fontSize: "12px",
  color: "var(--text-muted)",
};

// Inline, per-field validation error. Uses the DBS danger token
// (--status-danger; there is no --danger token in the palette).
export const fieldErrorStyle: CSSProperties = {
  marginTop: 4,
  fontSize: "12px",
  color: "var(--status-danger)",
};

export const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  border: "1px solid var(--status-danger)",
  background: "rgba(122,48,64,0.08)",
  color: "var(--status-danger)",
  fontSize: "13px",
};

export function applyFocus(
  e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
) {
  e.currentTarget.style.borderColor = "var(--accent)";
}

export function clearFocus(
  e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
) {
  e.currentTarget.style.borderColor = "var(--border)";
}
