"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!window.confirm("Cancel this shoot request? This can't be undone.")) {
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await cancelMyShootRequest(shootId);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "Failed to cancel request.");
      return;
    }

    router.push(closeHref);
    router.refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        style={{
          ...destructiveButtonStyle,
          opacity: submitting ? 0.6 : 1,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Cancelling…" : "Cancel request"}
      </button>
      {error && <p style={errorTextStyle}>{error}</p>}
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
