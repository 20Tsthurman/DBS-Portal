"use client";

import { useCallback, useMemo, useState } from "react";
import { Sidebar, type SidebarNavSection } from "@/components/ui/Sidebar";
import {
  DEFAULT_POLL_INTERVAL_MS,
  useVisibilityPolling,
} from "@/lib/hooks/useVisibilityPolling";

interface SidebarWithUnreadProps {
  eyebrow: string;
  navSections: SidebarNavSection[];
  viewerRole: "owner" | "client";
}

interface OwnerUnreadCountsResponse {
  total?: number;
}

interface ClientUnreadCountsResponse {
  count?: number;
}

export function SidebarWithUnread({
  eyebrow,
  navSections,
  viewerRole,
}: SidebarWithUnreadProps) {
  const [unreadCount, setUnreadCount] = useState(0);

  const pollUnreadCount = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await fetch("/api/messages/unread-counts", {
          cache: "no-store",
          signal,
        });

        if (!res.ok) {
          console.error("[SidebarWithUnread] fetch failed", res.status);
          return;
        }

        const json = (await res.json()) as
          | OwnerUnreadCountsResponse
          | ClientUnreadCountsResponse;

        const nextCount =
          viewerRole === "owner"
            ? typeof (json as OwnerUnreadCountsResponse).total === "number"
              ? (json as OwnerUnreadCountsResponse).total!
              : 0
            : typeof (json as ClientUnreadCountsResponse).count === "number"
              ? (json as ClientUnreadCountsResponse).count!
              : 0;

        setUnreadCount(Math.max(0, nextCount));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[SidebarWithUnread] fetch error", err);
      }
    },
    [viewerRole]
  );

  useVisibilityPolling(pollUnreadCount, {
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    invalidationEvent: "messages:invalidate-counts",
  });

  const messagesHref =
    viewerRole === "owner" ? "/owner/messages" : "/client/messages";

  const navSectionsWithUnread = useMemo(
    () =>
      navSections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.href === messagesHref
            ? { ...item, badge: unreadCount > 0 ? unreadCount : undefined }
            : item
        ),
      })),
    [messagesHref, navSections, unreadCount]
  );

  return <Sidebar eyebrow={eyebrow} navSections={navSectionsWithUnread} />;
}