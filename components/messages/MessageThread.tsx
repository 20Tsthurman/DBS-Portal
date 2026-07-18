"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { MessageRecord, SenderRole } from "@/lib/supabase";
import { formatMessageTimestamp } from "@/lib/formatRelativeTime";
import { MESSAGE_MAX_LENGTH } from "@/lib/messages";
import {
  DEFAULT_POLL_INTERVAL_MS,
  useVisibilityPolling,
} from "@/lib/hooks/useVisibilityPolling";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";

const CLUSTER_GAP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 80;
const COMPOSER_MAX_PX = 150;
const POST_MATCH_WINDOW_MS = 5_000;

interface MessageThreadProps {
  clientId: string;
  viewerRole: "owner" | "client";
  initialMessages?: MessageRecord[];
}

interface PendingMessage {
  tempId: string;
  body: string;
  sender_role: SenderRole;
  sent_at: string;
}

interface FailedMessage extends PendingMessage {
  error?: string;
}

type DisplayItem =
  | { kind: "confirmed"; id: string; sent_at: string; sender_role: SenderRole; body: string }
  | { kind: "pending"; id: string; sent_at: string; sender_role: SenderRole; body: string; tempId: string }
  | {
      kind: "failed";
      id: string;
      sent_at: string;
      sender_role: SenderRole;
      body: string;
      tempId: string;
      error?: string;
    };

interface Cluster {
  key: string;
  senderRole: SenderRole;
  firstSentAt: string;
  items: DisplayItem[];
}

export function MessageThread({
  clientId,
  viewerRole,
  initialMessages,
}: MessageThreadProps) {
  const otherRole: SenderRole = viewerRole === "owner" ? "client" : "owner";

  const [messages, setMessages] = useState<MessageRecord[]>(
    initialMessages ?? []
  );
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [failedMessages, setFailedMessages] = useState<FailedMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [newMessagesAvailable, setNewMessagesAvailable] = useState(false);
  const [hasFetched, setHasFetched] = useState(initialMessages !== undefined);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Read at keydown time only — see `useCoarsePointer` for why this is a ref
  // and why the hint below is a CSS swap rather than a branch on this value.
  const isCoarsePointerRef = useCoarsePointer();
  const isNearBottomRef = useRef(true);
  const knownIdsRef = useRef<Set<string>>(
    new Set((initialMessages ?? []).map((m) => m.id))
  );
  const lastRenderedIdsRef = useRef<Set<string>>(new Set());
  // Maps a server-confirmed message id → the tempId of the pending bubble it
  // replaced. Used to keep the same React key (and therefore the same DOM node)
  // across the pending→confirmed swap, so the opacity transition can run.
  const recentlyConfirmedRef = useRef<Map<string, string>>(new Map());
  const forceScrollToBottomRef = useRef(false);
  const isFirstScrollRef = useRef(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const markAsRead = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("messages:invalidate-counts"));
      }
    } catch (err) {
      console.error("[MessageThread] mark-as-read failed", err);
    }
  }, [clientId]);

  const markAsReadRef = useRef(markAsRead);
  useEffect(() => {
    markAsReadRef.current = markAsRead;
  }, [markAsRead]);

  const refetch = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(
          `/api/messages?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store", signal }
        );
        if (!res.ok) {
          console.error("[MessageThread] fetch failed", res.status);
          if (isMountedRef.current) setHasFetched(true);
          return;
        }
        const json = (await res.json()) as { messages?: MessageRecord[] };
        const server = json.messages ?? [];

        if (!isMountedRef.current) return;

        const known = knownIdsRef.current;
        const incoming: MessageRecord[] = [];
        for (const m of server) {
          if (!known.has(m.id)) {
            incoming.push(m);
            known.add(m.id);
          }
        }

        if (incoming.length > 0) {
          const hasUnreadFromOther = incoming.some(
            (m) => m.sender_role === otherRole && m.read_at === null
          );
          if (
            hasUnreadFromOther &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible"
          ) {
            void markAsReadRef.current();
          }
        }

        setHasFetched(true);
        setMessages(server);

        // Drop optimistic pending messages whose body+sender appeared on the
        // server within a 5s window — that's our "this POST landed and came
        // back via poll" heuristic. Record the realId→tempId pairing so the
        // confirmed bubble keeps the pending bubble's React key.
        setPendingMessages((prev) => {
          const stillPending: PendingMessage[] = [];
          for (const p of prev) {
            const pendingMs = new Date(p.sent_at).getTime();
            const match = server.find((s) => {
              if (s.sender_role !== p.sender_role) return false;
              if (s.body !== p.body) return false;
              return (
                Math.abs(new Date(s.sent_at).getTime() - pendingMs) <
                POST_MATCH_WINDOW_MS
              );
            });
            if (match) {
              recentlyConfirmedRef.current.set(match.id, p.tempId);
            } else {
              stillPending.push(p);
            }
          }
          return stillPending;
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[MessageThread] fetch error", err);
        if (isMountedRef.current) setHasFetched(true);
      }
    },
    [clientId, otherRole]
  );

  // Mount: if initialMessages already includes unread from the other party,
  // mark as read once. New arrivals via poll are handled inside refetch.
  useEffect(() => {
    const hasUnread = (initialMessages ?? []).some(
      (m) => m.sender_role === otherRole && m.read_at === null
    );
    if (
      hasUnread &&
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    ) {
      void markAsRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling. Visibility-aware: see `useVisibilityPolling` for the contract —
  // immediate fetch on mount, pause on hidden, resume + immediate fetch on
  // visible, single abort-controller per fetch.
  useVisibilityPolling(refetch, { intervalMs: DEFAULT_POLL_INTERVAL_MS });

  // Combined, sorted display list.
  const displayList = useMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = [];
    for (const m of messages) {
      // Reuse the prior pending bubble's tempId as the stable id when this
      // message was just confirmed, so React reconciles the same DOM node.
      const stableId = recentlyConfirmedRef.current.get(m.id) ?? m.id;
      items.push({
        kind: "confirmed",
        id: stableId,
        sent_at: m.sent_at,
        sender_role: m.sender_role,
        body: m.body,
      });
    }
    for (const p of pendingMessages) {
      items.push({
        kind: "pending",
        id: p.tempId,
        sent_at: p.sent_at,
        sender_role: p.sender_role,
        body: p.body,
        tempId: p.tempId,
      });
    }
    for (const f of failedMessages) {
      items.push({
        kind: "failed",
        id: f.tempId,
        sent_at: f.sent_at,
        sender_role: f.sender_role,
        body: f.body,
        tempId: f.tempId,
        error: f.error,
      });
    }
    items.sort((a, b) =>
      a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : 0
    );
    return items;
  }, [messages, pendingMessages, failedMessages]);

  const clusters = useMemo<Cluster[]>(() => {
    const out: Cluster[] = [];
    for (const item of displayList) {
      const prev = out[out.length - 1];
      if (prev) {
        const prevLast = prev.items[prev.items.length - 1];
        const sameRole = prev.senderRole === item.sender_role;
        const gap =
          new Date(item.sent_at).getTime() -
          new Date(prevLast.sent_at).getTime();
        if (sameRole && gap < CLUSTER_GAP_MS) {
          prev.items.push(item);
          continue;
        }
      }
      out.push({
        key: item.id,
        senderRole: item.sender_role,
        firstSentAt: item.sent_at,
        items: [item],
      });
    }
    return out;
  }, [displayList]);

  // Scroll management. Runs whenever the display list changes; only acts
  // when IDs newly appeared (so a no-op poll triggers nothing).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const lastSeen = lastRenderedIdsRef.current;
    const newItems = displayList.filter((i) => !lastSeen.has(i.id));
    lastRenderedIdsRef.current = new Set(displayList.map((i) => i.id));
    if (newItems.length === 0) return;

    if (isFirstScrollRef.current) {
      isFirstScrollRef.current = false;
      container.scrollTop = container.scrollHeight;
      return;
    }

    if (forceScrollToBottomRef.current) {
      forceScrollToBottomRef.current = false;
      container.scrollTop = container.scrollHeight;
      setNewMessagesAvailable(false);
      return;
    }

    if (isNearBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      setNewMessagesAvailable(false);
      return;
    }

    const newFromOther = newItems.some(
      (i) => i.sender_role === otherRole && i.kind === "confirmed"
    );
    if (newFromOther) setNewMessagesAvailable(true);
  }, [displayList, otherRole]);

  // Composer auto-resize.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [composer]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - (container.scrollTop + container.clientHeight);
    const near = distance <= NEAR_BOTTOM_PX;
    isNearBottomRef.current = near;
    if (near && newMessagesAvailable) setNewMessagesAvailable(false);
  }, [newMessagesAvailable]);

  const sendOnce = useCallback(
    async (pending: PendingMessage) => {
      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, body: pending.body }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(json?.error ?? `Send failed (${res.status})`);
        }
        setPendingMessages((prev) =>
          prev.filter((p) => p.tempId !== pending.tempId)
        );
        void refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Send failed";
        setPendingMessages((prev) =>
          prev.filter((p) => p.tempId !== pending.tempId)
        );
        setFailedMessages((prev) => [
          ...prev,
          { ...pending, error: message },
        ]);
      }
    },
    [clientId, refetch]
  );

  const handleSend = useCallback(() => {
    const trimmed = composer.trim();
    if (!trimmed) return;
    const pending: PendingMessage = {
      tempId: `temp-${crypto.randomUUID()}`,
      body: trimmed,
      sender_role: viewerRole,
      sent_at: new Date().toISOString(),
    };
    setPendingMessages((prev) => [...prev, pending]);
    setComposer("");
    forceScrollToBottomRef.current = true;
    textareaRef.current?.focus();
    void sendOnce(pending);
  }, [composer, viewerRole, sendOnce]);

  const handleRetry = useCallback(
    (tempId: string) => {
      const failed = failedMessages.find((f) => f.tempId === tempId);
      if (!failed) return;
      setFailedMessages((prev) => prev.filter((f) => f.tempId !== tempId));
      const pending: PendingMessage = {
        tempId: failed.tempId,
        body: failed.body,
        sender_role: failed.sender_role,
        sent_at: failed.sent_at,
      };
      setPendingMessages((prev) => [...prev, pending]);
      void sendOnce(pending);
    },
    [failedMessages, sendOnce]
  );

  const handleComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // On a touch keyboard the Enter key sits where Return belongs, so hijacking
    // it makes multi-paragraph messages impossible to type; there send is the
    // button only. Fine pointers keep Enter-to-send unchanged.
    if (isCoarsePointerRef.current) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const scrollToBottomNow = () => {
    const c = scrollRef.current;
    if (!c) return;
    c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
    setNewMessagesAvailable(false);
  };

  const sendDisabled = composer.trim().length === 0;
  const isEmpty =
    messages.length === 0 &&
    pendingMessages.length === 0 &&
    failedMessages.length === 0;
  const lastDisplayItem = displayList[displayList.length - 1];

  return (
    <div style={rootStyle}>
      <div style={refreshRowStyle}>
        <button
          type="button"
          onClick={() => void refetch()}
          title="Refresh"
          aria-label="Refresh messages"
          className="min-h-[44px] min-w-[44px] lg:min-h-0 lg:min-w-0"
          style={refreshButtonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          ↻
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={scrollAreaStyle}
      >
        {!hasFetched && (
          <div style={loadingStateStyle}>Loading messages...</div>
        )}
        {clusters.map((cluster) => {
          const alignRight = cluster.senderRole === viewerRole;
          return (
            <div key={cluster.key} style={{ marginBottom: 16 }}>
              <div
                style={{
                  ...clusterTimestampStyle,
                  textAlign: alignRight ? "right" : "left",
                }}
              >
                {formatMessageTimestamp(cluster.firstSentAt)}
              </div>
              {cluster.items.map((item) => {
                const isLastOverall = item === lastDisplayItem;
                const showStatus =
                  isLastOverall && alignRight && item.kind !== "failed";
                const statusKind: StatusKind | null = showStatus
                  ? item.kind === "pending"
                    ? "sending"
                    : "delivered"
                  : null;
                return (
                  <MessageBubble
                    key={item.id}
                    item={item}
                    alignRight={alignRight}
                    onRetry={
                      item.kind === "failed"
                        ? () => handleRetry(item.tempId)
                        : undefined
                    }
                    statusKind={statusKind}
                  />
                );
              })}
            </div>
          );
        })}

        {newMessagesAvailable && (
          <button
            type="button"
            onClick={scrollToBottomNow}
            style={newMessagesIndicatorStyle}
          >
            New messages ↓
          </button>
        )}
      </div>

      {hasFetched && isEmpty && (
        <div style={emptyStateStyle}>
          No messages yet. Send the first one below.
        </div>
      )}

      <div style={composerWrapStyle}>
        <div style={composerRowStyle}>
          <textarea
            ref={textareaRef}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Write a message…"
            rows={1}
            maxLength={MESSAGE_MAX_LENGTH}
            style={textareaStyle}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sendDisabled}
            className="min-h-[44px] lg:min-h-0"
            style={{
              ...sendButtonStyle,
              opacity: sendDisabled ? 0.5 : 1,
              cursor: sendDisabled ? "not-allowed" : "pointer",
            }}
          >
            Send
          </button>
        </div>
        <div style={composerFooterStyle}>
          {/* Both hints render; CSS picks one. Keyed off `pointer: coarse` —
              the same predicate `useCoarsePointer` feeds the keydown handler,
              so the copy can never contradict the behaviour (a width-based
              `lg:` swap would lie on a wide tablet and on a narrow desktop
              window). Rendering both also keeps SSR output unconditional. */}
          <span style={hintStyle}>
            <span className="composer-hint-fine">
              Enter to send · Shift+Enter for newline
            </span>
            <span className="composer-hint-coarse">
              Tap Send to send · Enter for a new line
            </span>
          </span>
          <span style={counterStyle}>
            {composer.length}/{MESSAGE_MAX_LENGTH}
          </span>
        </div>
      </div>

      <style>{`
        .composer-hint-coarse { display: none; }
        @media (pointer: coarse) {
          .composer-hint-fine { display: none; }
          .composer-hint-coarse { display: inline; }
        }
      `}</style>
    </div>
  );
}

type StatusKind = "sending" | "delivered";

function MessageBubble({
  item,
  alignRight,
  onRetry,
  statusKind,
}: {
  item: DisplayItem;
  alignRight: boolean;
  onRetry?: () => void;
  statusKind: StatusKind | null;
}) {
  const isFailed = item.kind === "failed";
  const isPending = item.kind === "pending";

  // Captured once on first render. If the bubble first mounted as pending
  // (i.e. the viewer just sent it), it gets the entrance animation. Bubbles
  // that first render as confirmed (poll results, SSR, other party's
  // messages) start at their final position with no animation.
  const wasInitiallyPendingRef = useRef(item.kind === "pending");
  const [entered, setEntered] = useState(!wasInitiallyPendingRef.current);

  useEffect(() => {
    if (!wasInitiallyPendingRef.current) return;
    // Double rAF: commit the initial transform/opacity in one paint, then
    // flip to the target on the next frame so the transition actually runs.
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
    };
  }, []);

  const targetOpacity = isPending ? 0.6 : 1;
  const baseBubble: CSSProperties = {
    display: "inline-block",
    maxWidth: "70%",
    padding: "12px 16px",
    fontSize: 14,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    backgroundColor: alignRight
      ? "var(--sidebar-bg)"
      : "var(--surface-raised)",
    color: alignRight ? "var(--surface-base)" : "var(--text-primary)",
    opacity: entered ? targetOpacity : 0,
    transform: entered
      ? "translateY(0) scale(1)"
      : "translateY(28px) scale(0.92)",
    transformOrigin: alignRight ? "bottom right" : "bottom left",
    transition:
      "transform 350ms cubic-bezier(0.16, 1, 0.3, 1), " +
      "opacity 350ms cubic-bezier(0.16, 1, 0.3, 1)",
    borderLeft: isFailed ? "3px solid var(--status-danger)" : undefined,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: alignRight ? "flex-end" : "flex-start",
        marginBottom: 4,
      }}
    >
      <div style={baseBubble}>{item.body}</div>
      {isFailed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
            fontSize: 11,
            color: "var(--status-danger)",
          }}
        >
          <span>
            {item.kind === "failed" && item.error
              ? `Couldn't send — ${item.error}`
              : "Couldn't send"}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={retryButtonStyle}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {statusKind && <StatusLabel kind={statusKind} />}
    </div>
  );
}

function StatusLabel({ kind }: { kind: StatusKind }) {
  // Fade in on mount. When the latest sent message changes, the previous
  // label unmounts and a fresh StatusLabel mounts for the new latest, so an
  // enter-only animation is sufficient. Sending→Delivered on the SAME bubble
  // just swaps text + italic state without re-running the fade.
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      style={{
        marginTop: 2,
        paddingRight: 4,
        fontSize: 11,
        color: "var(--text-muted)",
        fontStyle: kind === "sending" ? "italic" : "normal",
        opacity,
        transition: "opacity 300ms ease-out",
      }}
    >
      {kind === "sending" ? "Sending..." : "Delivered"}
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  backgroundColor: "var(--surface-base)",
};

const refreshRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "8px 16px",
  borderBottom: "1px solid var(--border)",
};

const refreshButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  padding: "4px 8px",
  transition: "color 120ms ease-out",
};

const scrollAreaStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "16px 20px",
  position: "relative",
};

const clusterTimestampStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  marginBottom: 4,
  letterSpacing: "0.02em",
};

const newMessagesIndicatorStyle: CSSProperties = {
  position: "sticky",
  bottom: 8,
  display: "block",
  margin: "0 auto",
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "none",
  cursor: "pointer",
};

const emptyStateStyle: CSSProperties = {
  padding: "12px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 13,
  borderTop: "1px solid var(--border)",
};

const loadingStateStyle: CSSProperties = {
  padding: "12px 16px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 13,
};

const composerWrapStyle: CSSProperties = {
  borderTop: "1px solid var(--border)",
  padding: "12px 16px 10px",
  backgroundColor: "var(--surface-raised)",
};

const composerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
};

const textareaStyle: CSSProperties = {
  flex: 1,
  resize: "none",
  fontFamily: "inherit",
  // 16px suppresses iOS Safari's auto-zoom on focus. No height here — the
  // auto-resize effect drives height off scrollHeight, capped at COMPOSER_MAX_PX.
  fontSize: 16,
  lineHeight: 1.45,
  padding: "10px 12px",
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-base)",
  color: "var(--text-primary)",
  outline: "none",
  maxHeight: COMPOSER_MAX_PX,
  overflowY: "auto",
};

const sendButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "none",
};

const composerFooterStyle: CSSProperties = {
  marginTop: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
};

const counterStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
  fontVariantNumeric: "tabular-nums",
};

const retryButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--status-danger)",
  cursor: "pointer",
  textDecoration: "underline",
};
