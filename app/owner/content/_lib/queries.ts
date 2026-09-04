import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentCycleRecord,
  type ContentItemRecord,
} from "@/lib/supabase";

/**
 * A cycle plus its client's display name. Cycles are one-per-client-per-month
 * (enforced by `content_cycles_client_month_unique` in migration 015), so a
 * month view holds at most one cycle per client.
 */
export interface CycleWithClient extends ContentCycleRecord {
  client_name: string;
}

/**
 * An item plus its LIVE assets — `replaced_at is null` only. Superseded rows
 * are version history and never render on the building surface.
 */
export interface ContentItemWithAssets extends ContentItemRecord {
  client_name: string;
  assets: ContentAssetRecord[];
}

export interface ContentClientOption {
  id: string;
  name: string;
}

/** YYYY-MM → the `content_cycles.month` value (always the first of the month). */
export function monthKeyToCycleMonth(monthKey: string): string {
  return `${monthKey}-01`;
}

type RawJoinedClient = { name: string };

function joinedName(
  joined: RawJoinedClient | RawJoinedClient[] | null | undefined
): string {
  const row = Array.isArray(joined) ? joined[0] : joined;
  return row?.name ?? "";
}

/**
 * Clients eligible to have content built for them. Inactive clients are
 * excluded for the same reason the invoice picker excludes them — building a
 * month for a client who has left is almost always a mistake.
 */
export async function fetchContentClients(): Promise<ContentClientOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .neq("status", "inactive")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContentClientOption[];
}

export async function fetchCyclesForMonth(
  monthKey: string,
  clientId?: string
): Promise<CycleWithClient[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("content_cycles")
    .select(
      "id, client_id, month, revision_deadline, included_rounds, extra_round_price, status, locked_at, locked_by, created_at, clients!inner(name)"
    )
    .eq("month", monthKeyToCycleMonth(monthKey));
  if (clientId) query = query.eq("client_id", clientId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<
    ContentCycleRecord & { clients: RawJoinedClient | RawJoinedClient[] }
  >;
  return rows
    .map((row) => ({
      id: row.id,
      client_id: row.client_id,
      month: row.month,
      revision_deadline: row.revision_deadline,
      included_rounds: row.included_rounds,
      extra_round_price:
        row.extra_round_price === null ? null : Number(row.extra_round_price),
      status: row.status,
      locked_at: row.locked_at,
      locked_by: row.locked_by,
      created_at: row.created_at,
      client_name: joinedName(row.clients),
    }))
    .sort((a, b) => a.client_name.localeCompare(b.client_name));
}

/**
 * Items belonging to the given cycles, each with its live assets attached.
 *
 * Scoping by `cycle_id` rather than a `scheduled_for` range is deliberate: a
 * cycle already IS the month, so this needs no timezone range math and cannot
 * drift at a month boundary the way a UTC-vs-Central range comparison would.
 */
export async function fetchItemsForCycles(
  cycleIds: string[]
): Promise<ContentItemWithAssets[]> {
  if (cycleIds.length === 0) return [];
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("content_items")
    .select(
      "id, client_id, cycle_id, scheduled_for, platform, format, caption, status, current_round, approved_at, approved_by, sort_order, created_at, clients!inner(name)"
    )
    .in("cycle_id", cycleIds)
    .order("scheduled_for", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<
    ContentItemRecord & { clients: RawJoinedClient | RawJoinedClient[] }
  >;
  if (rows.length === 0) return [];

  const assetsByItem = await fetchLiveAssetsByItem(rows.map((r) => r.id));

  return rows.map((row) => ({
    id: row.id,
    client_id: row.client_id,
    cycle_id: row.cycle_id,
    scheduled_for: row.scheduled_for,
    platform: row.platform,
    format: row.format,
    caption: row.caption,
    status: row.status,
    current_round: row.current_round,
    approved_at: row.approved_at,
    approved_by: row.approved_by,
    sort_order: row.sort_order,
    created_at: row.created_at,
    client_name: joinedName(row.clients),
    assets: assetsByItem.get(row.id) ?? [],
  }));
}

/**
 * Live assets for a set of items, keyed by item id and ordered by `position`.
 * The `replaced_at is null` filter matches the partial unique index that
 * guarantees one current asset per position.
 */
async function fetchLiveAssetsByItem(
  itemIds: string[]
): Promise<Map<string, ContentAssetRecord[]>> {
  const out = new Map<string, ContentAssetRecord[]>();
  if (itemIds.length === 0) return out;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .in("content_item_id", itemIds)
    .is("replaced_at", null)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  for (const raw of (data ?? []) as ContentAssetRecord[]) {
    const list = out.get(raw.content_item_id);
    if (list) list.push(raw);
    else out.set(raw.content_item_id, [raw]);
  }
  return out;
}

/** Live assets for a single item — used to refresh one item's photo strip. */
export async function fetchLiveAssetsForItem(
  itemId: string
): Promise<ContentAssetRecord[]> {
  const byItem = await fetchLiveAssetsByItem([itemId]);
  return byItem.get(itemId) ?? [];
}
