"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Sync-on-view trigger for the Google Calendar import.
 *
 * Fires one POST to /api/google/sync when the owner calendar mounts and
 * refreshes the server-rendered views if the sync pulled changes. The write
 * happens in the API route, never during server render; the route also
 * enforces a 60s skip window so week/month navigation doesn't hammer the
 * Google API. Failures are silent — the calendar still shows the last
 * imported state and the daily cron catches up.
 */
export function GoogleSyncOnView() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/google/sync", { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { changed?: boolean } | null) => {
        if (!cancelled && data?.changed) router.refresh();
      })
      .catch(() => {
        // Not connected / offline / transient error — nothing to do.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
