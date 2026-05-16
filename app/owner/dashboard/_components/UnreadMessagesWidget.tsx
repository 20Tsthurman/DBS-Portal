"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/ui/StatCard";
import {
  DEFAULT_POLL_INTERVAL_MS,
  useVisibilityPolling,
} from "@/lib/hooks/useVisibilityPolling";
import type {
  OwnerUnreadCounts,
  UnreadClient,
} from "@/app/owner/messages/_lib/queries";
import { DashboardCard } from "@/components/ui/DashboardCard";

interface UnreadMessagesWidgetProps {
  initial: OwnerUnreadCounts;
}

/**
 * Live-updating unread-messages summary. SSR'd via `fetchUnreadCountsForOwner`
 * for a correct first paint, then polled every 30s through
 * `/api/messages/unread-counts`. Also listens for the cross-component
 * `messages:invalidate-counts` event so opening a thread refreshes the widget
 * instantly.
 */
export function UnreadMessagesWidget({ initial }: UnreadMessagesWidgetProps) {
  const [total, setTotal] = useState(initial.total);
  const [clients, setClients] = useState<UnreadClient[]>(initial.clients);

  const refetch = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/messages/unread-counts", {
        cache: "no-store",
        signal,
      });
      if (!res.ok) {
        console.error("[UnreadMessagesWidget] fetch failed", res.status);
        return;
      }
      const json = (await res.json()) as Partial<OwnerUnreadCounts>;
      if (typeof json.total === "number") setTotal(Math.max(0, json.total));
      if (Array.isArray(json.clients)) setClients(json.clients);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[UnreadMessagesWidget] fetch error", err);
    }
  }, []);

  useVisibilityPolling(refetch, {
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    invalidationEvent: "messages:invalidate-counts",
  });

  const topClients = clients.slice(0, 3);

  return (
    <DashboardCard eyebrow="MESSAGES" title="Unread">
      <StatCard label="Awaiting your reply" value={total} />
      {total > 0 ? (
        topClients.length > 0 && (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "16px 0 0",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {topClients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/owner/messages?clientId=${c.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    color: "inherit",
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--accent)",
                      flexShrink: 0,
                      marginLeft: 12,
                    }}
                  >
                    {c.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p
          style={{
            marginTop: 16,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          All caught up.
        </p>
      )}
    </DashboardCard>
  );
}
