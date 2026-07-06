import { NextResponse } from "next/server";
import { syncFromGoogle } from "@/lib/google/sync";

export const dynamic = "force-dynamic";

/**
 * Daily Google Calendar sync. Same Bearer CRON_SECRET contract as
 * /api/cron/unread-reminders (Vercel cron sends the header; the schedule
 * lives in vercel.json — Hobby caps crons at daily, and the sync-on-view
 * trigger on /owner/calendar carries intraday freshness).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !authHeader || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncFromGoogle();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
