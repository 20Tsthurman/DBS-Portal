import { NextResponse } from "next/server";
import {
  getSupabaseServiceClient,
  type SenderRole,
} from "@/lib/supabase";
import { requireOwnerOrClientApi } from "@/lib/auth";

interface ReadBody {
  clientId?: unknown;
}

export async function PATCH(request: Request) {
  const gate = await requireOwnerOrClientApi();
  if (gate instanceof NextResponse) return gate;
  const { role } = gate;

  let clientId: string;
  let otherRole: SenderRole;

  if (role === "client") {
    clientId = gate.client.id;
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
