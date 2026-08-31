import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import { fetchCycleRollup } from "@/app/owner/content/_lib/rollup";

/**
 * Where a client stands in one released cycle (spec 4.5), for the owner-side
 * poll.
 *
 * OWNER-ONLY, and the guard is the same `requireOwnerApi` every other owner
 * route uses. That matters more than it looks: the response is one client's
 * review progress, and the route takes a `cycleId` from the caller with no
 * ownership scoping of its own. Kelsey is the only role that can reach it, and
 * every cycle is hers by definition, so there is no second party to scope
 * against — but that is a property of the guard, not of the handler, and this
 * route must never be widened to `requireOwnerOrClientApi` without adding one.
 *
 * GET, not POST: this only reads. The sibling asset-status route is a POST
 * because it writes what Cloudflare tells it.
 */
export async function GET(request: Request) {
  const authError = await requireOwnerApi();
  if (authError) return authError;

  const cycleId = new URL(request.url).searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  try {
    const rollup = await fetchCycleRollup(cycleId);
    return NextResponse.json({ rollup });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load client progress";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
