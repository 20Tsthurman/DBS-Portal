import type { ShootStatus } from "@/lib/supabase";

/**
 * Tone map for the dashboard's shoot widgets.
 *
 * Per the dashboard spec: requested → warning, confirmed → success.
 * This differs from `shootStatusTone` in `app/owner/shoots/_lib/format.ts`
 * (neutral/accent) — the shoots LIST emphasises confirmed shoots with the
 * accent colour, but the DASHBOARD uses a traffic-light read where requested
 * (action needed) is the noisy one and confirmed (settled) is the calm one.
 * Kept local to dashboard components to avoid disturbing the shoots list.
 *
 * Completed/cancelled/declined shouldn't appear in either widget — the
 * queries filter them out — but we map them defensively so a future
 * regression doesn't crash on an unknown tone.
 */
export type DashboardShootTone = "success" | "warning" | "neutral" | "danger";

export function shootTone(status: ShootStatus): DashboardShootTone {
  switch (status) {
    case "requested":
      return "warning";
    case "confirmed":
      return "success";
    case "completed":
      return "neutral";
    case "cancelled":
    case "declined":
      return "danger";
  }
}
