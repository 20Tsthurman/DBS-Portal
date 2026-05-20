import type { CSSProperties } from "react";

interface PaymentBannerProps {
  paid: boolean;
  canceled: boolean;
  invoiceNumber?: string;
}

export function PaymentBanner({
  paid,
  canceled,
  invoiceNumber,
}: PaymentBannerProps) {
  if (paid) {
    const numberClause = invoiceNumber ? ` for ${invoiceNumber}` : "";
    return (
      <div role="status" style={paidStyle}>
        Payment received{numberClause} — your invoice is being updated.
        Refresh in a moment to see the status.
      </div>
    );
  }
  if (canceled) {
    return (
      <div role="status" style={canceledStyle}>
        Payment canceled. Click <strong>Pay Now</strong> when you&apos;re ready
        to try again.
      </div>
    );
  }
  return null;
}

const paidStyle: CSSProperties = {
  marginBottom: 20,
  padding: "14px 18px",
  border: "1px solid var(--status-success)",
  borderTop: "3px solid var(--status-success)",
  backgroundColor: "rgba(45,106,79,0.08)",
  color: "var(--status-success)",
  fontSize: 13,
  lineHeight: 1.5,
};

const canceledStyle: CSSProperties = {
  marginBottom: 20,
  padding: "14px 18px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  color: "var(--text-body)",
  fontSize: 13,
  lineHeight: 1.5,
};
