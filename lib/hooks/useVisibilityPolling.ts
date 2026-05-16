"use client";

import { useEffect, useRef } from "react";

/**
 * Shared default poll cadence (30s) for owner/client live-update surfaces.
 * Centralised so unread badge, inbox, and thread all tick at the same rate.
 */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;

export type UseVisibilityPollingOptions = {
  intervalMs: number;
  invalidationEvent?: string;
  enabled?: boolean; // default true
};

/**
 * Run `fetcher` on mount, then on a fixed interval — but only while the tab
 * is visible. When the tab hides we tear the interval down; when it returns
 * to visible we fire one immediate fetch and re-arm the interval.
 *
 * The hook owns a single `AbortController` per in-flight fetch. It aborts on:
 *   - unmount
 *   - tab going hidden
 *   - the next fetch starting (the previous controller is replaced)
 *   - `enabled` flipping false
 *
 * If `invalidationEvent` is provided we also call `fetcher` whenever that
 * event fires on `window` — used by the messages stack to fan out
 * `messages:invalidate-counts` without coupling components together.
 *
 * The fetcher owns its own try/catch (and any application-level error
 * surfacing). The hook never wraps the call in a try/catch; instead it
 * forwards the abort signal so the fetcher can attach it to `fetch()`
 * and bail cleanly on the standard `AbortError`.
 */
export function useVisibilityPolling(
  fetcher: (signal: AbortSignal) => Promise<void>,
  options: UseVisibilityPollingOptions
): void {
  const { intervalMs, invalidationEvent, enabled = true } = options;

  // Keep a ref to the latest fetcher so changing it doesn't force the polling
  // effect to tear down and re-arm (which would re-fire the immediate fetch
  // every time the consumer re-creates the callback).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let activeController: AbortController | null = null;

    const runFetch = () => {
      // Replace any prior in-flight fetch — only one at a time.
      if (activeController) {
        activeController.abort();
      }
      const controller = new AbortController();
      activeController = controller;
      void fetcherRef.current(controller.signal);
    };

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(runFetch, intervalMs);
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
        // Abort any in-flight request so we don't hold a stale connection
        // open while the user is away.
        if (activeController) {
          activeController.abort();
          activeController = null;
        }
        stop();
      } else if (document.visibilityState === "visible") {
        runFetch();
        start();
      }
    };

    // Mount: fetch once immediately, then arm the interval if visible.
    if (document.visibilityState === "visible") {
      runFetch();
      start();
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    };
  }, [enabled, intervalMs]);

  useEffect(() => {
    if (!enabled) return;
    if (!invalidationEvent) return;
    if (typeof window === "undefined") return;

    const handler = () => {
      const controller = new AbortController();
      void fetcherRef.current(controller.signal);
    };
    window.addEventListener(invalidationEvent, handler);
    return () => {
      window.removeEventListener(invalidationEvent, handler);
    };
  }, [enabled, invalidationEvent]);
}
