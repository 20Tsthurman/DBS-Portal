import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getSupabaseServiceClient,
  type SenderRole,
} from "@/lib/supabase";
import { getCurrentClient } from "@/lib/currentClient";

interface ReadBody {
  clientId?: unknown;
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  if (role !== "owner" && role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let clientId: string;
  let otherRole: SenderRole;

  if (role === "client") {
    const clientRecord = await getCurrentClient();
    if (!clientRecord) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    clientId = clientRecord.id;
    otherRole = "owner";
  } else {
    let payload: ReadBody;
    try {
      payload = (await request.json()) as ReadBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }
    if (
      typeof payload.clientId !== "string" ||
      payload.clientId.length === 0
    ) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }
    clientId = payload.clientId;
    otherRole = "client";
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("sender_role", otherRole)
    .is("read_at", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: data?.length ?? 0 });
}
