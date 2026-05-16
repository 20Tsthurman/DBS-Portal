import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getCurrentClient } from "@/lib/currentClient";
import {
  fetchUnreadCountsForOwner,
  type OwnerUnreadCounts,
  type UnreadClient,
} from "@/app/owner/messages/_lib/queries";

/**
 * Response shape for GET /api/messages/unread-counts.
 *
 * Owners get the full owner payload (counts + total + sorted clients list).
 * Clients get a single number — their own unread count from the owner.
 *
 * Re-exported types are sourced from `app/owner/messages/_lib/queries.ts` so
 * the dashboard SSR widget and the polled API call share one source of truth.
 */
export type UnreadCountsResponse =
  | OwnerUnreadCounts
  | { count: number };

export type { UnreadClient };

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  if (role !== "owner" && role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseServiceClient();

  if (role === "owner") {
    try {
      const payload = await fetchUnreadCountsForOwner();
      return NextResponse.json(payload satisfies UnreadCountsResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const clientRecord = await getCurrentClient();
  if (!clientRecord) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { count, error } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientRecord.id)
    .eq("sender_role", "owner")
    .is("read_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
