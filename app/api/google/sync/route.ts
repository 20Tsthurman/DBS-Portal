import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import { syncFromGoogle } from "@/lib/google/sync";

export const dynamic = "force-dynamic";

/**
 * Sync-on-view trigger. The owner calendar POSTs here on mount (see
 * GoogleSyncOnView) and refreshes itself when `changed` comes back true.
 * The 60s skip window keeps rapid week/month navigation from burning Google
 * API quota — the daily cron guarantees a floor of freshness regardless.
 */
const MIN_SYNC_INTERVAL_MS = 60 * 1000;

export async function POST() {
  const denied = await requireOwnerApi();
  if (denied) return denied;

  try {
    const result = await syncFromGoogle({
      skipIfSyncedWithinMs: MIN_SYNC_INTERVAL_MS,
    });
    return NextResponse.json({
      ok: true,
      status: result.status,
      changed: result.status === "synced" ? result.changed : false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-sync] on-view sync failed", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
