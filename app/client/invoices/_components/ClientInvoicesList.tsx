import type { CSSProperties } from "react";
import { ClientInvoiceRow } from "./ClientInvoiceRow";
import type { InvoiceWithClient } from "../_lib/queries";

interface ClientInvoicesListProps {
  invoices: InvoiceWithClient[];
}

export function ClientInvoicesList({ invoices }: ClientInvoicesListProps) {
  if (invoices.length === 0) {
    return <div style={emptyStateStyle}>No invoices yet.</div>;
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {invoices.map((invoice) => (
          <ClientInvoiceRow key={invoice.id} invoice={invoice} />
        ))}
      </ul>
    </div>
  );
}

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 14,
};
