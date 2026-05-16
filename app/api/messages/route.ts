import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type MessageRecord,
  type SenderRole,
} from "@/lib/supabase";
import { getCurrentClient } from "@/lib/currentClient";
import { maybeSendNewMessageEmail } from "@/lib/messageNotifications";

interface SendBody {
  clientId?: unknown;
  body?: unknown;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  if (role !== "owner" && role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const supabase = getSupabaseServiceClient();
  let clientId: string;
  let senderRole: SenderRole;
  let clientRecord: ClientRecord;

  if (role === "client") {
    const current = await getCurrentClient();
    if (!current) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    clientId = current.id;
    senderRole = "client";
    clientRecord = current;
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
    return NextResponse.json(
      {
        message: inserted,
        warning: `Notification failed: ${notifyResult.error}`,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({ message: inserted }, { status: 201 });
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  if (role !== "owner" && role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  let clientId: string;
  if (role === "client") {
    const clientRecord = await getCurrentClient();
    if (!clientRecord) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    clientId = clientRecord.id;
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
