import {
  getSupabaseServiceClient,
  type ClientType,
  type SenderRole,
} from "@/lib/supabase";

export interface InboxClient {
  id: string;
  name: string;
  type: ClientType;
  lastMessage: {
    body: string;
    sent_at: string;
    sender_role: SenderRole;
  } | null;
  unreadCount: number;
}

interface ActiveClientRow {
  id: string;
  name: string;
  type: ClientType;
}

interface MessageRow {
  client_id: string;
  body: string;
  sent_at: string;
  sender_role: SenderRole;
}

export async function fetchInboxClients(): Promise<InboxClient[]> {
  const supabase = getSupabaseServiceClient();

  const { data: clientsData, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, type")
    .neq("status", "inactive");
  if (clientsError) throw new Error(clientsError.message);

  const clients = (clientsData ?? []) as ActiveClientRow[];
  if (clients.length === 0) return [];

  const clientIds = clients.map((c) => c.id);

  const [messagesRes, unreadRes] = await Promise.all([
    supabase
      .from("messages")
      .select("client_id, body, sent_at, sender_role")
      .in("client_id", clientIds)
      .order("sent_at", { ascending: false }),
    supabase
      .from("messages")
      .select("client_id")
      .in("client_id", clientIds)
      .eq("sender_role", "client")
      .is("read_at", null),
  ]);

  if (messagesRes.error) throw new Error(messagesRes.error.message);
  if (unreadRes.error) throw new Error(unreadRes.error.message);

  // First (most recent) row per client_id — list is already sorted desc.
  const latestByClient = new Map<string, MessageRow>();
  for (const row of (messagesRes.data ?? []) as MessageRow[]) {
    if (!latestByClient.has(row.client_id)) {
      latestByClient.set(row.client_id, row);
    }
  }

  const unreadCounts = new Map<string, number>();
  for (const row of (unreadRes.data ?? []) as Pick<MessageRow, "client_id">[]) {
    unreadCounts.set(
      row.client_id,
      (unreadCounts.get(row.client_id) ?? 0) + 1
    );
  }

  const out: InboxClient[] = clients.map((c) => {
    const latest = latestByClient.get(c.id);
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      lastMessage: latest
        ? {
            body: latest.body,
            sent_at: latest.sent_at,
            sender_role: latest.sender_role,
          }
        : null,
      unreadCount: unreadCounts.get(c.id) ?? 0,
    };
  });

  out.sort((a, b) => {
    if (a.lastMessage && b.lastMessage) {
      return a.lastMessage.sent_at < b.lastMessage.sent_at ? 1 : -1;
    }
    if (a.lastMessage) return -1;
    if (b.lastMessage) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return out;
}
