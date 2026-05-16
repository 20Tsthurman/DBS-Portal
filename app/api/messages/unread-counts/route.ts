import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { getCurrentClient } from "@/lib/currentClient";

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
    // Supabase JS doesn't expose GROUP BY directly. Fetch the client_id of
    // every unread client→owner message and bucket in JS. Expected volume
    // is small (a few hundred rows max across all clients).
    const { data, error } = await supabase
      .from("messages")
      .select("client_id")
      .eq("sender_role", "client")
      .is("read_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of (data ?? []) as { client_id: string }[]) {
      counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
      total += 1;
    }

    return NextResponse.json({ counts, total });
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
