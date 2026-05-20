"use client";

import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { InvoiceFormPanel } from "./InvoiceFormPanel";
import { InvoicesTable } from "./InvoicesTable";
import { MarkPaidPanel } from "./MarkPaidPanel";
import type {
  ClientPickerOption,
  InvoiceWithClient,
} from "../_lib/queries";

interface InvoicesBoardProps {
  invoices: InvoiceWithClient[];
  clients: ClientPickerOption[];
  mode?: "standalone" | "embedded";
  /** Pre-fills the client picker on create; used by the per-client tab. */
  defaultClientId?: string;
}

export function InvoicesBoard({
  invoices,
  clients,
  mode = "standalone",
  defaultClientId,
}: InvoicesBoardProps) {
  const [editingInvoice, setEditingInvoice] =
    useState<InvoiceWithClient | null>(null);
  const [creating, setCreating] = useState(false);
  const [defaultSendOnOpen, setDefaultSendOnOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<InvoiceWithClient | null>(
    null
  );

  const handleEdit = (invoice: InvoiceWithClient) => {
    setDefaultSendOnOpen(false);
    setEditingInvoice(invoice);
  };

  const handleSend = (invoice: InvoiceWithClient) => {
    // "Send" on a row opens the form panel with the send-immediately
    // toggle pre-checked. The confirm dialog still gates the actual send.
    setDefaultSendOnOpen(true);
    setEditingInvoice(invoice);
  };

  const handleMarkPaid = (invoice: InvoiceWithClient) => {
    setMarkingPaid(invoice);
  };

  const handleClosePanels = () => {
    setEditingInvoice(null);
    setCreating(false);
    setMarkingPaid(null);
    setDefaultSendOnOpen(false);
  };

  return (
    <div>
      <div style={headerRowStyle}>
        <Button
          type="button"
          onClick={() => {
            setDefaultSendOnOpen(false);
            setCreating(true);
          }}
          style={{ minWidth: 140 }}
        >
          New invoice
        </Button>
      </div>

      <InvoicesTable
        invoices={invoices}
        mode={mode}
        onEdit={handleEdit}
        onSend={handleSend}
        onMarkPaid={handleMarkPaid}
      />

      <InvoiceFormPanel
        open={creating || editingInvoice !== null}
        onClose={handleClosePanels}
        invoice={editingInvoice}
        clients={clients}
        defaultClientId={creating ? defaultClientId : undefined}
        defaultSendImmediately={defaultSendOnOpen}
      />

      <MarkPaidPanel
        open={markingPaid !== null}
        onClose={handleClosePanels}
        invoice={markingPaid}
      />
    </div>
  );
}

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginBottom: 16,
};
