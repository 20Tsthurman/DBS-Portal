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
import {
  DEFAULT_POLL_INTERVAL_MS,
  useVisibilityPolling,
} from "@/lib/hooks/useVisibilityPolling";
import type { InboxClient } from "../_lib/queries";

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
  // selectedClientId is derived from the URL — URL is the single source of
  // truth. Keeping a separate `useState` plus a URL→state sync effect raced
  // with router.push: setting state to null and pushing the new URL didn't
  // happen atomically, so the sync effect would re-read the still-stale URL
  // and revert state back to the old clientId, forcing the user to tap Back
  // twice. Deriving from URL eliminates the race; browser back/forward
  // automatically resyncs for free.
  const selectedClientId = searchParams.get("clientId");

  // Auto-select most-recent thread on first mount when no clientId in URL.
  // On mobile the list and thread share the same screen — auto-selecting would
  // skip the list entirely, so the auto-select only fires at lg+.
  useEffect(() => {
    if (selectedClientId !== null) return;
    if (initialClients.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1024px)").matches
    ) {
      return;
    }
    const firstId = initialClients[0].id;
    router.replace(`/owner/messages?clientId=${firstId}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetch = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/messages/inbox", {
        cache: "no-store",
        signal,
      });
      if (!res.ok) {
        console.error("[MessagesInbox] fetch failed", res.status);
        return;
      }
      const json = (await res.json()) as { clients?: InboxClient[] };
      if (json.clients) setClients(json.clients);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[MessagesInbox] fetch error", err);
    }
  }, []);

  // Polling — visibility-aware. Same contract as MessageThread + sidebar.
  // Note: this is the only one of the three call sites that previously did
  // NOT fire an immediate fetch on mount (initialClients arrives from the
  // server). After the hook migration it WILL fetch once on mount; that's a
  // negligible extra request right after SSR but the data shape is identical
  // so no visible UI change is expected.
  useVisibilityPolling(refetch, {
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    invalidationEvent: "messages:invalidate-counts",
  });

  const handleSelect = useCallback(
    (id: string) => {
      setClients((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
      );
      router.push(`/owner/messages?clientId=${id}`, { scroll: false });
    },
    [router]
  );

  const handleBackToList = useCallback(() => {
    router.push(`/owner/messages`, { scroll: false });
  }, [router]);

  const sortedClients = useMemo(() => clients, [clients]);
  const isThreadActive = selectedClientId !== null;

  return (
    <div
      className="flex h-[calc(100dvh-180px)] min-h-[420px] lg:h-[calc(100vh-220px)] lg:min-h-[480px]"
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-base)",
      }}
    >
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
      <div
        className={`${
          isThreadActive ? "hidden lg:block" : "block"
        } w-full flex-shrink-0 overflow-y-auto lg:w-[320px]`}
        style={{
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--surface-base)",
        }}
      >
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

      <div
        className={`${
          isThreadActive ? "flex" : "hidden lg:flex"
        } min-w-0 min-h-0 flex-1 flex-col`}
        style={{ backgroundColor: "var(--surface-base)" }}
      >
        {isThreadActive && (
          <button
            type="button"
            onClick={handleBackToList}
            className="flex w-full items-center min-h-[44px] px-4 lg:hidden"
            style={{
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--surface-raised)",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-body)",
              border: "none",
              borderBottomWidth: "1px",
              borderBottomStyle: "solid",
              borderBottomColor: "var(--border)",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            ← Back to conversations
          </button>
        )}
        {selectedClientId ? (
          <div className="flex flex-1 min-h-0 flex-col">
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

const inboxEmptyStyle: CSSProperties = {
  padding: "32px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 13,
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
