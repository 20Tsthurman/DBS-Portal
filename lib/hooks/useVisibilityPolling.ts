"use client";

import { useCallback, useEffect, useRef } from "react";

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

  // Single AbortController across both effects: at any given time the hook
  // owns at most one in-flight fetch. Lifted here so the invalidation-event
  // handler can abort a poll mid-flight (and vice versa), and so unmount
  // cleanup from either effect can tear down whichever is current.
  const controllerRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort();
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    void fetcherRef.current(controller.signal);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

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
        if (controllerRef.current) {
          controllerRef.current.abort();
          controllerRef.current = null;
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
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, [enabled, intervalMs, runFetch]);

  useEffect(() => {
    if (!enabled) return;
    if (!invalidationEvent) return;
    if (typeof window === "undefined") return;

    const handler = () => {
      runFetch();
    };
    window.addEventListener(invalidationEvent, handler);
    return () => {
      window.removeEventListener(invalidationEvent, handler);
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, [enabled, invalidationEvent, runFetch]);
}
