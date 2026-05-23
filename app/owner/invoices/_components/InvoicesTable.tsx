"use client";

import type { CSSProperties } from "react";
import { MobileCardList } from "@/components/ui/MobileCard";
import { InvoiceRow } from "./InvoiceRow";
import { InvoiceCard } from "./InvoiceCard";
import type { InvoiceWithClient } from "../_lib/queries";

interface InvoicesTableProps {
  invoices: InvoiceWithClient[];
  mode: "standalone" | "embedded";
  onEdit: (invoice: InvoiceWithClient) => void;
  onSend: (invoice: InvoiceWithClient) => void;
  onMarkPaid: (invoice: InvoiceWithClient) => void;
}

export function InvoicesTable({
  invoices,
  mode,
  onEdit,
  onSend,
  onMarkPaid,
}: InvoicesTableProps) {
  const showClient = mode === "standalone";

  if (invoices.length === 0) {
    return (
      <div style={emptyStateStyle}>
        {mode === "embedded" ? (
          "No invoices for this client yet."
        ) : (
          <>
            <p style={{ margin: 0 }}>No invoices in this view.</p>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              Try a different filter.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className="hidden lg:block"
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-raised)",
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              {showClient && <th>Client</th>}
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Issued</th>
              <th style={{ textAlign: "right" }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                showClient={showClient}
                onEdit={onEdit}
                onSend={onSend}
                onMarkPaid={onMarkPaid}
              />
            ))}
          </tbody>
        </table>
      </div>

      <MobileCardList className="lg:hidden">
        {invoices.map((invoice) => (
          <InvoiceCard
            key={invoice.id}
            invoice={invoice}
            showClient={showClient}
            onEdit={onEdit}
            onSend={onSend}
            onMarkPaid={onMarkPaid}
          />
        ))}
      </MobileCardList>
    </>
  );
}

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-body)",
  fontSize: 14,
};
