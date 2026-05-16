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

export interface UnreadClient {
  id: string;
  name: string;
  count: number;
}

export interface OwnerUnreadCounts {
  /** Per-client unread bucket — useful for callers that need to look up by id. */
  counts: Record<string, number>;
  /** Total unread (client→owner) messages across all clients. */
  total: number;
  /** Clients with at least one unread message, sorted count desc then name asc. */
  clients: UnreadClient[];
}

/**
 * Aggregates unread client→owner messages for the dashboard widget and the
 * `/api/messages/unread-counts` owner branch. Both call sites read the same
 * shape so the route handler and the SSR widget stay in sync.
 *
 * Supabase JS doesn't expose GROUP BY directly, so we fetch the client_id of
 * every unread message and bucket in JS. Volume is small (a few hundred rows
 * across all clients in normal use).
 */
export async function fetchUnreadCountsForOwner(): Promise<OwnerUnreadCounts> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("messages")
    .select("client_id")
    .eq("sender_role", "client")
    .is("read_at", null);
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of (data ?? []) as { client_id: string }[]) {
    counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
    total += 1;
  }

  const clientIds = Object.keys(counts);
  if (clientIds.length === 0) {
    return { counts, total, clients: [] };
  }

  const { data: clientsData, error: clientsError } = await supabase
    .from("clients")
    .select("id, name")
    .in("id", clientIds);
  if (clientsError) throw new Error(clientsError.message);

  const clients: UnreadClient[] = (
    (clientsData ?? []) as Array<{ id: string; name: string }>
  ).map((c) => ({ id: c.id, name: c.name, count: counts[c.id] ?? 0 }));

  clients.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { counts, total, clients };
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
