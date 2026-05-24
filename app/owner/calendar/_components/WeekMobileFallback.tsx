"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface WeekMobileFallbackProps {
  /** URL to send the user to when the viewport is below lg. */
  fallbackHref: string;
}

/**
 * Week view is desktop-only — its absolutely-positioned 7×24 time grid does
 * not fit a phone. If we land here below the lg breakpoint, immediately
 * redirect to the equivalent month view so the user never sees the broken
 * frame. The redirect runs once on mount; resizing past lg later is the
 * user's choice (they can tap Week again from the desktop toggle).
 */
export function WeekMobileFallback({ fallbackHref }: WeekMobileFallbackProps) {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      router.replace(fallbackHref);
    }
  }, [router, fallbackHref]);
  return null;
}
