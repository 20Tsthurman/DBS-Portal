import Link from "next/link";
import type { CSSProperties } from "react";
import { contentHref, type ContentView } from "../_lib/href";
import type { ContentClientOption } from "../_lib/queries";

interface ClientFilterPillsProps {
  clients: ContentClientOption[];
  /** null = the "All clients" pill is active. */
  activeClientId: string | null;
  monthKey: string;
  view: ContentView;
}

/**
 * Link-based query-param filtering, the same shape as the invoices
 * `StatusFilterPills`. Deliberately a copy rather than an import: that
 * component hard-codes its item list and `/owner/invoices` hrefs, so there is
 * nothing to parameterize without rewriting it for one extra consumer.
 *
 * Unlike the invoice version the item list is data, not a constant — the
 * container already wraps, which matters more here since the roster grows.
 */
export function ClientFilterPills({
  clients,
  activeClientId,
  monthKey,
  view,
}: ClientFilterPillsProps) {
  const items: Array<{ id: string | null; label: string }> = [
    { id: null, label: "All clients" },
    ...clients.map((c) => ({ id: c.id, label: c.name })),
  ];

  return (
    <div style={containerStyle}>
      {items.map((item, i) => {
        const isActive = item.id === activeClientId;
        return (
          <Link
            key={item.id ?? "all"}
            href={contentHref({ monthKey, clientId: item.id, view })}
            aria-pressed={isActive}
            style={{
              ...pillStyle,
              borderRight:
                i < items.length - 1 ? "none" : "1px solid var(--border)",
              backgroundColor: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "#FFFFFF" : "var(--text-body)",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

const containerStyle: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  marginBottom: 24,
};

const pillStyle: CSSProperties = {
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  border: "1px solid var(--border)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
