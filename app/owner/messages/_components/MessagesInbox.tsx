"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageThread } from "@/components/messages/MessageThread";
import { formatInboxTimestamp } from "@/lib/formatRelativeTime";
import type { InboxClient } from "../_lib/queries";

const POLL_INTERVAL_MS = 30_000;

interface MessagesInboxProps {
  initialClients: InboxClient[];
  initialSelectedId: string | null;
}

export function MessagesInbox({
  initialClients,
  initialSelectedId,
}: MessagesInboxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [clients, setClients] = useState<InboxClient[]>(initialClients);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    initialSelectedId
  );

  // Auto-select most-recent thread on first mount when no clientId in URL.
  useEffect(() => {
    if (selectedClientId === null && initialClients.length > 0) {
      const firstId = initialClients[0].id;
      setSelectedClientId(firstId);
      router.replace(`/owner/messages?clientId=${firstId}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL → state sync (back/forward button).
  useEffect(() => {
    const urlId = searchParams.get("clientId");
    if (urlId && urlId !== selectedClientId) {
      setSelectedClientId(urlId);
    }
  }, [searchParams, selectedClientId]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/inbox", { cache: "no-store" });
      if (!res.ok) {
        console.error("[MessagesInbox] fetch failed", res.status);
        return;
      }
      const json = (await res.json()) as { clients?: InboxClient[] };
      if (json.clients) setClients(json.clients);
    } catch (err) {
      console.error("[MessagesInbox] fetch error", err);
    }
  }, []);

  // Polling — same visibility-aware pattern as MessageThread.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(() => {
          void refetch();
        }, POLL_INTERVAL_MS);
      }
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void refetch();
        stop();
      } else if (document.visibilityState === "visible") {
        void refetch();
        start();
      }
    };

    if (typeof document !== "undefined") {
      if (document.visibilityState === "visible") {
        start();
      }
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [refetch]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleInvalidate = () => {
      void refetch();
    };
    window.addEventListener("messages:invalidate-counts", handleInvalidate);
    return () => {
      window.removeEventListener(
        "messages:invalidate-counts",
        handleInvalidate
      );
    };
  }, [refetch]);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedClientId(id);
      setClients((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
      );
      router.push(`/owner/messages?clientId=${id}`, { scroll: false });
    },
    [router]
  );

  const sortedClients = useMemo(() => clients, [clients]);

  return (
    <div style={containerStyle}>
      <style>{`
        .inbox-row {
          background-color: transparent;
          border-left: 3px solid transparent;
        }
        .inbox-row:hover {
          background-color: var(--surface-raised);
        }
        .inbox-row-selected,
        .inbox-row-selected:hover {
          background-color: var(--surface-raised);
          border-left-color: var(--accent);
        }
      `}</style>
      <div style={inboxColumnStyle}>
        {sortedClients.length === 0 ? (
          <div style={inboxEmptyStyle}>No active clients yet.</div>
        ) : (
          sortedClients.map((c) => (
            <InboxRow
              key={c.id}
              client={c}
              selected={c.id === selectedClientId}
              onSelect={() => handleSelect(c.id)}
            />
          ))
        )}
      </div>

      <div style={threadColumnStyle}>
        {selectedClientId ? (
          <div style={threadInnerStyle}>
            <MessageThread
              key={selectedClientId}
              clientId={selectedClientId}
              viewerRole="owner"
            />
          </div>
        ) : (
          <div style={threadEmptyStyle}>
            Select a conversation from the list.
          </div>
        )}
      </div>
    </div>
  );
}

function InboxRow({
  client,
  selected,
  onSelect,
}: {
  client: InboxClient;
  selected: boolean;
  onSelect: () => void;
}) {
  const hasMessage = client.lastMessage !== null;
  const preview = hasMessage ? client.lastMessage!.body : "No messages yet";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`inbox-row${selected ? " inbox-row-selected" : ""}`}
      style={rowButtonStyle}
    >
      <div style={topRowStyle}>
        <span style={nameStyle}>{client.name}</span>
        {client.lastMessage && (
          <span style={timestampStyle}>
            {formatInboxTimestamp(client.lastMessage.sent_at)}
          </span>
        )}
      </div>
      <div style={bottomRowStyle}>
        <span
          style={{
            ...previewStyle,
            color: hasMessage ? "var(--text-body)" : "var(--text-muted)",
            fontStyle: hasMessage ? "normal" : "italic",
          }}
        >
          {preview}
        </span>
        {client.unreadCount > 0 && (
          <span style={badgeStyle}>{client.unreadCount}</span>
        )}
      </div>
    </button>
  );
}

const containerStyle: CSSProperties = {
  display: "flex",
  height: "calc(100vh - 220px)",
  minHeight: 480,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-base)",
};

const inboxColumnStyle: CSSProperties = {
  width: 320,
  flexShrink: 0,
  borderRight: "1px solid var(--border)",
  overflowY: "auto",
  backgroundColor: "var(--surface-base)",
};

const inboxEmptyStyle: CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 13,
};

const threadColumnStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  backgroundColor: "var(--surface-base)",
};

const threadInnerStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const threadEmptyStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-muted)",
  fontSize: 14,
};

const rowButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "12px 16px",
  border: "none",
  borderBottom: "1px solid var(--border)",
  fontFamily: "inherit",
  cursor: "pointer",
  transition: "background-color 120ms ease-out",
};

const topRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 4,
};

const nameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

const timestampStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  flexShrink: 0,
};

const bottomRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const previewStyle: CSSProperties = {
  fontSize: 13,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 220,
  minWidth: 0,
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  fontSize: 11,
  fontWeight: 600,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  flexShrink: 0,
};
