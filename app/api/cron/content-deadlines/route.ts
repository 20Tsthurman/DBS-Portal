import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { runDeadlineSweep } from "@/app/owner/content/_lib/cycleLock";

export const dynamic = "force-dynamic";

/**
 * Daily deadline sweep (spec §3.9, §4.3, §5.7). Same Bearer CRON_SECRET
 * contract as /api/cron/unread-reminders and /api/cron/google-sync — Vercel
 * cron sends the header; the schedule lives in vercel.json. `0 7 * * *` UTC
 * is 2am CDT / 1am CST, after the 23:59 Central deadline in both, on Hobby's
 * once-a-day ±59-minute precision, so the lock lands one to three hours after
 * the deadline. An hour earlier would put the CST floor at one minute, and a
 * run that fires before the deadline costs a full day.
 *
 * The work lives in `runDeadlineSweep`, shared with Kelsey's Lock now; this
 * file is the guard and the JSON envelope, nothing more. One log line per
 * run so a day's outcome is readable in Vercel without opening the response.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (
    !process.env.CRON_SECRET ||
    !authHeader ||
    authHeader !== expected
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDeadlineSweep(getSupabaseServiceClient());
    console.log("[content-deadlines] sweep", summary);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
