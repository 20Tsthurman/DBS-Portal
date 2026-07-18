import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type MessageRecord,
  type SenderRole,
} from "@/lib/supabase";
import { requireOwnerOrClientApi } from "@/lib/auth";
import { maybeSendNewMessageEmail } from "@/lib/messageNotifications";
import { MESSAGE_MAX_LENGTH } from "@/lib/messages";

interface SendBody {
  clientId?: unknown;
  body?: unknown;
}

export async function POST(request: Request) {
  const gate = await requireOwnerOrClientApi();
  if (gate instanceof NextResponse) return gate;
  const { role } = gate;

  let payload: SendBody;
  try {
    payload = (await request.json()) as SendBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof payload.body !== "string") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  const trimmed = payload.body.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "body must be non-empty" },
      { status: 400 }
    );
  }
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `Message is too long (maximum ${MESSAGE_MAX_LENGTH} characters).`,
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceClient();
  let clientId: string;
  let senderRole: SenderRole;
  let clientRecord: ClientRecord;

  if (role === "client") {
    clientId = gate.client.id;
    senderRole = "client";
    clientRecord = gate.client;
  } else {
    if (typeof payload.clientId !== "string" || payload.clientId.length === 0) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }
    const { data: existing, error: lookupError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", payload.clientId)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    clientId = payload.clientId;
    senderRole = "owner";
    clientRecord = existing as ClientRecord;
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      client_id: clientId,
      sender_role: senderRole,
      body: trimmed,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to send message" },
      { status: 500 }
    );
  }

  const inserted = data as MessageRecord;

  const notifyResult = await maybeSendNewMessageEmail({
    clientId,
    newMessageId: inserted.id,
    senderRole,
    clientRecord,
  });

  revalidatePath("/owner/messages");
  revalidatePath("/client/messages");

  if (!notifyResult.sent && notifyResult.error) {
    console.error(
      `[messages] notification failed for message ${inserted.id}: ${notifyResult.error}`
    );
    return NextResponse.json(
      { message: inserted, notified: false },
      { status: 207 }
    );
  }

  return NextResponse.json({ message: inserted }, { status: 201 });
}

export async function GET(request: Request) {
  const gate = await requireOwnerOrClientApi();
  if (gate instanceof NextResponse) return gate;
  const { role } = gate;

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  let clientId: string;
  if (role === "client") {
    clientId = gate.client.id;
  } else {
    const queryClientId = url.searchParams.get("clientId");
    if (!queryClientId) {
      return NextResponse.json(
        { error: "clientId is required" },
        { status: 400 }
      );
    }
    clientId = queryClientId;
  }

  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("messages")
    .select("*")
    .eq("client_id", clientId)
    .order("sent_at", { ascending: true });
  if (since) {
    query = query.gt("sent_at", since);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    messages: (data ?? []) as MessageRecord[],
  });
}
