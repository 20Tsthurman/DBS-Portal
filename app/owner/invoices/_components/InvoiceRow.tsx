"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatDate } from "@/app/owner/clients/_lib/format";
import {
  createInvoicePdfDownloadUrlAction,
  deleteInvoiceAction,
} from "../_actions";
import {
  formatInvoiceAmount,
  formatIssuedFromTimestamp,
  statusLabelFor,
  statusToneFor,
} from "../_lib/format";
import type { InvoiceWithClient } from "../_lib/queries";

interface InvoiceRowProps {
  invoice: InvoiceWithClient;
  showClient: boolean;
  onEdit: (invoice: InvoiceWithClient) => void;
  onSend: (invoice: InvoiceWithClient) => void;
  onMarkPaid: (invoice: InvoiceWithClient) => void;
}

export function InvoiceRow({
  invoice,
  showClient,
  onEdit,
  onSend,
  onMarkPaid,
}: InvoiceRowProps) {
  const router = useRouter();
  const status = invoice.effective_status;
  const isDraft = status === "draft";
  const isPaid = status === "paid";

  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const total = invoice.line_items.reduce(
    (sum, li) => sum + Number(li.amount),
    0
  );

  const handleDownload = async () => {
    setError(null);
    setDownloading(true);
    const res = await createInvoicePdfDownloadUrlAction({
      invoiceId: invoice.id,
    });
    setDownloading(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? "Could not generate link");
      return;
    }
    window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleConfirmDelete = () => {
    startDeleteTransition(async () => {
      const res = await deleteInvoiceAction({ invoiceId: invoice.id });
      if (!res.ok) {
        setError(res.error ?? "Delete failed");
        return;
      }
      setConfirmDelete(false);
      router.refresh();
    });
  };

  return (
    <>
      <tr>
        <td style={cellPrimary}>
          <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>
            {invoice.invoice_number ?? "—"}
          </span>
        </td>
        {showClient && <td>{invoice.client_name}</td>}
        <td style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
          {formatInvoiceAmount(total)}
        </td>
        <td>
          <StatusPill tone={statusToneFor(status)}>
            {statusLabelFor(status)}
          </StatusPill>
        </td>
        <td>{formatDate(invoice.due_date)}</td>
        <td>{formatIssuedFromTimestamp(invoice.sent_at)}</td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {isDraft && (
            <>
              <button
                type="button"
                onClick={() => onEdit(invoice)}
                style={rowActionStyle}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onSend(invoice)}
                style={rowActionStyle}
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                style={{
                  ...rowActionStyle,
                  color: "var(--status-danger)",
                }}
              >
                Delete
              </button>
            </>
          )}
          {(status === "sent" || status === "overdue") && (
            <>
              <button
                type="button"
                onClick={() => onEdit(invoice)}
                style={rowActionStyle}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onMarkPaid(invoice)}
                style={rowActionStyle}
              >
                Mark Paid
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  ...rowActionStyle,
                  opacity: downloading ? 0.6 : 1,
                  cursor: downloading ? "not-allowed" : "pointer",
                }}
              >
                {downloading ? "Opening…" : "PDF"}
              </button>
            </>
          )}
          {isPaid && (
            <>
              <button
                type="button"
                onClick={() => onEdit(invoice)}
                style={rowActionStyle}
              >
                View
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  ...rowActionStyle,
                  opacity: downloading ? 0.6 : 1,
                  cursor: downloading ? "not-allowed" : "pointer",
                }}
              >
                {downloading ? "Opening…" : "PDF"}
              </button>
            </>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={showClient ? 7 : 6}>
            <div role="alert" style={errorBannerStyle}>
              {error}
            </div>
          </td>
        </tr>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => {
          if (isDeleting) return;
          setConfirmDelete(false);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete draft invoice?"
        body={
          <>
            Delete draft{" "}
            <strong>{invoice.invoice_number ?? "(no number)"}</strong>? This
            can&apos;t be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        busy={isDeleting}
      />
    </>
  );
}

const cellPrimary: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 14,
};

const rowActionStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
  marginLeft: 4,
};

const errorBannerStyle: CSSProperties = {
  margin: "8px 12px",
  padding: "8px 12px",
  border: "1px solid var(--status-danger)",
  backgroundColor: "rgba(122,48,64,0.08)",
  color: "var(--status-danger)",
  fontSize: 12,
};
