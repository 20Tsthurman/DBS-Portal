"use client";

import { useState, type CSSProperties } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatDate } from "@/app/owner/clients/_lib/format";
import {
  formatInvoiceAmount,
  formatIssuedFromTimestamp,
  statusLabelFor,
  statusToneFor,
} from "@/app/owner/invoices/_lib/format";
import type { InvoiceWithClient } from "../_lib/queries";
import {
  createInvoicePdfDownloadUrlAction,
  createPaymentSessionAction,
} from "../_actions";

interface ClientInvoiceRowProps {
  invoice: InvoiceWithClient;
}

export function ClientInvoiceRow({ invoice }: ClientInvoiceRowProps) {
  const status = invoice.effective_status;
  const isPaid = status === "paid";
  const isOpen = status === "sent" || status === "overdue";

  const [busy, setBusy] = useState<"pay" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = invoice.line_items.reduce(
    (sum, li) => sum + Number(li.amount),
    0
  );

  const handlePay = async () => {
    setError(null);
    setBusy("pay");
    const res = await createPaymentSessionAction({ invoiceId: invoice.id });
    if (!res.ok || !res.data) {
      setBusy(null);
      setError(res.error ?? "Could not start checkout");
      return;
    }
    // Hard navigation — Stripe Checkout is a hosted page.
    window.location.href = res.data.url;
  };

  const handleDownload = async () => {
    setError(null);
    setBusy("download");
    const res = await createInvoicePdfDownloadUrlAction({
      invoiceId: invoice.id,
    });
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.error ?? "Could not generate link");
      return;
    }
    window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <li style={rowStyle}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={numberStyle}>
            {invoice.invoice_number ?? "(no number)"}
          </span>
          <StatusPill tone={statusToneFor(status)}>
            {statusLabelFor(status)}
          </StatusPill>
        </div>
        <div style={metaStyle}>
          <span style={amountStyle}>{formatInvoiceAmount(total)}</span>
          <span style={metaSepStyle}>·</span>
          <span>Issued {formatIssuedFromTimestamp(invoice.sent_at)}</span>
          <span style={metaSepStyle}>·</span>
          <span>Due {formatDate(invoice.due_date)}</span>
        </div>
        {invoice.memo && <p style={memoStyle}>{invoice.memo}</p>}
        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
      </div>

      {isOpen && (
        <button
          type="button"
          onClick={handlePay}
          disabled={busy !== null}
          style={{
            ...primaryButtonStyle,
            opacity: busy !== null ? 0.6 : 1,
            cursor: busy !== null ? "not-allowed" : "pointer",
          }}
        >
          {busy === "pay" ? "Opening…" : "Pay Now"}
        </button>
      )}
      {isPaid && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={busy !== null}
          style={{
            ...secondaryButtonStyle,
            opacity: busy !== null ? 0.6 : 1,
            cursor: busy !== null ? "not-allowed" : "pointer",
          }}
        >
          {busy === "download" ? "Opening…" : "Download Receipt"}
        </button>
      )}
    </li>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "16px 18px",
  borderBottom: "1px solid var(--border)",
};

const numberStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 16,
  color: "var(--text-primary)",
};

const amountStyle: CSSProperties = {
  fontWeight: 600,
  color: "var(--text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const metaStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "var(--text-body)",
};

const metaSepStyle: CSSProperties = {
  color: "var(--text-muted)",
};

const memoStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  fontStyle: "italic",
  color: "var(--text-muted)",
};

const errorStyle: CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "var(--status-danger)",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "transparent",
  color: "var(--text-body)",
  border: "1px solid var(--border)",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
