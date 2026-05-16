"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sidebar, type SidebarNavItem } from "@/components/ui/Sidebar";

const POLL_INTERVAL_MS = 30_000;

interface SidebarWithUnreadProps {
  eyebrow: string;
  navItems: SidebarNavItem[];
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
  navItems,
  viewerRole,
}: SidebarWithUnreadProps) {
  const [unreadCount, setUnreadCount] = useState(0);

  const pollUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/unread-counts", {
        cache: "no-store",
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
      console.error("[SidebarWithUnread] fetch error", err);
    }
  }, [viewerRole]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(() => {
          void pollUnreadCount();
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
        void pollUnreadCount();
        stop();
      } else if (document.visibilityState === "visible") {
        void pollUnreadCount();
        start();
      }
    };

    if (typeof document !== "undefined") {
      if (document.visibilityState === "visible") {
        void pollUnreadCount();
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
  }, [pollUnreadCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleInvalidate = () => {
      void pollUnreadCount();
    };
    window.addEventListener("messages:invalidate-counts", handleInvalidate);
    return () => {
      window.removeEventListener(
        "messages:invalidate-counts",
        handleInvalidate
      );
    };
  }, [pollUnreadCount]);

  const messagesHref =
    viewerRole === "owner" ? "/owner/messages" : "/client/messages";

  const navItemsWithUnread = useMemo(
    () =>
      navItems.map((item) =>
        item.href === messagesHref
          ? { ...item, badge: unreadCount > 0 ? unreadCount : undefined }
          : item
      ),
    [messagesHref, navItems, unreadCount]
  );

  return <Sidebar eyebrow={eyebrow} navItems={navItemsWithUnread} />;
}