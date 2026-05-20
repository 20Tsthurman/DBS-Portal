"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import { markInvoicePaidAction } from "../_actions";
import { formatInvoiceAmount, PAYMENT_METHOD_LABELS } from "../_lib/format";
import type { InvoiceWithClient } from "../_lib/queries";

interface MarkPaidPanelProps {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceWithClient | null;
}

type PaymentMethod =
  | "zelle"
  | "venmo"
  | "direct_deposit"
  | "check"
  | "cash"
  | "other";

const PAYMENT_METHODS: PaymentMethod[] = [
  "zelle",
  "venmo",
  "direct_deposit",
  "check",
  "cash",
  "other",
];

function todayKey(): string {
  // Local-tz date key for the date input default.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function MarkPaidPanel({ open, onClose, invoice }: MarkPaidPanelProps) {
  const router = useRouter();
  const fieldId = useId();

  const [paymentDate, setPaymentDate] = useState(todayKey());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("zelle");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPaymentDate(todayKey());
    setPaymentMethod("zelle");
    setNotes("");
    setError(null);
  }, [open]);

  const total = invoice
    ? invoice.line_items.reduce((sum, li) => sum + Number(li.amount), 0)
    : 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invoice) return;
    if (!paymentDate) {
      setError("Payment date is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await markInvoicePaidAction({
        invoiceId: invoice.id,
        paymentDate,
        paymentMethod,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed to mark paid.");
        return;
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlidePanel
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Mark as paid"
    >
      <form
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
        style={{ minHeight: 0 }}
      >
        <div className="flex-1 space-y-5">
          {invoice && (
            <div style={contextStyle}>
              <span style={contextNumberStyle}>{invoice.invoice_number}</span>
              <span style={contextSepStyle}>·</span>
              <span style={contextClientStyle}>{invoice.client_name}</span>
              <span style={contextSepStyle}>·</span>
              <span style={contextAmountStyle}>
                {formatInvoiceAmount(total)}
              </span>
            </div>
          )}

          <div>
            <label htmlFor={`${fieldId}-date`} style={labelStyle}>
              Payment date
            </label>
            <input
              id={`${fieldId}-date`}
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-method`} style={labelStyle}>
              Payment method
            </label>
            <select
              id={`${fieldId}-method`}
              required
              value={paymentMethod}
              onChange={(e) =>
                setPaymentMethod(e.target.value as PaymentMethod)
              }
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={fieldStyle}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${fieldId}-notes`} style={labelStyle}>
              Notes <span style={{ opacity: 0.6 }}>(optional)</span>
            </label>
            <textarea
              id={`${fieldId}-notes`}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onFocus={applyFocus}
              onBlur={clearFocus}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </div>

          {error && <div style={errorStyle}>{error}</div>}
        </div>

        <div
          style={{
            paddingTop: 24,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              ...cancelButtonStyle,
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <Button type="submit" disabled={submitting} style={{ minWidth: 140 }}>
            {submitting ? "Saving…" : "Mark paid"}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}

const contextStyle: CSSProperties = {
  padding: "12px 14px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-base)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const contextNumberStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontWeight: 500,
  color: "var(--text-primary)",
  fontSize: 15,
};

const contextSepStyle: CSSProperties = {
  color: "var(--text-muted)",
};

const contextClientStyle: CSSProperties = {
  color: "var(--text-body)",
  fontSize: 13,
};

const contextAmountStyle: CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  fontSize: 13,
};

const cancelButtonStyle: CSSProperties = {
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
};
