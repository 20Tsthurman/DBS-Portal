import Link from "next/link";
import type { CSSProperties } from "react";
import type { FileRecord, MessageRecord } from "@/lib/supabase";
import type { InvoiceWithClient } from "@/app/client/invoices/_lib/queries";
import { formatCurrency, formatDate } from "@/app/owner/clients/_lib/format";

interface ActivityFeedProps {
  lastInvoice: InvoiceWithClient | null;
  lastFile: FileRecord | null;
  lastMessage: MessageRecord | null;
}

interface ActivityItem {
  key: string;
  /** ISO timestamp used only for sorting. */
  timestamp: string;
  label: string;
  detail: string;
  href: string;
}

const FILE_TYPE_LABEL: Record<FileRecord["file_type"], string> = {
  content: "Content",
  contract: "Contract",
  invoice: "Invoice",
  other: "File",
};

function truncate(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildItems({
  lastInvoice,
  lastFile,
  lastMessage,
}: ActivityFeedProps): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (lastInvoice) {
    const status =
      lastInvoice.effective_status.charAt(0).toUpperCase() +
      lastInvoice.effective_status.slice(1);
    items.push({
      key: `invoice-${lastInvoice.id}`,
      // Drafts are excluded upstream, so sent_at is set; created_at is a
      // safety fallback for any legacy row.
      timestamp: lastInvoice.sent_at ?? lastInvoice.created_at,
      label: lastInvoice.invoice_number
        ? `Invoice ${lastInvoice.invoice_number}`
        : "Invoice",
      detail: `${status} · ${formatCurrency(lastInvoice.amount)}`,
      href: "/client/invoices",
    });
  }

  if (lastFile) {
    items.push({
      key: `file-${lastFile.id}`,
      timestamp: lastFile.uploaded_at,
      label: lastFile.name,
      detail: `${FILE_TYPE_LABEL[lastFile.file_type]} uploaded`,
      href: "/client/files",
    });
  }

  if (lastMessage) {
    items.push({
      key: `message-${lastMessage.id}`,
      timestamp: lastMessage.sent_at,
      label:
        lastMessage.sender_role === "owner"
          ? "Message from Kelsey"
          : "You sent a message",
      detail: truncate(lastMessage.body),
      href: "/client/messages",
    });
  }

  // ISO 8601 timestamps sort lexically; newest first.
  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function ActivityFeed(props: ActivityFeedProps) {
  const items = buildItems(props);

  if (items.length === 0) {
    return (
      <div style={emptyStateStyle}>
        Nothing here yet. As Kelsey shares files, sends invoices, and messages
        you, your latest updates will appear here.
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((item, idx) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="agenda-row"
              style={{
                ...rowStyle,
                borderTop: idx === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={labelStyle}>{item.label}</p>
                <p style={detailStyle}>{item.detail}</p>
              </div>
              <span style={metaStyle}>{formatDate(item.timestamp)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "14px 18px",
  textDecoration: "none",
};

const labelStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 500,
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const detailStyle: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12,
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const metaStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 12,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 14,
};
