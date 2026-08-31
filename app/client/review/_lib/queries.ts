import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
  type ContentCycleRecord,
  type ContentItemRecord,
} from "@/lib/supabase";

/**
 * The client's own reads for /client/review.
 *
 * OWNERSHIP IS PATTERN A THROUGHOUT — `client_id` is baked into every query
 * rather than checked after the fact (the shape of `fetchMyInvoiceById`,
 * `app/client/invoices/_lib/queries.ts`). Nothing here can return a row
 * belonging to someone else, and a wrong id returns `null` identically to a
 * missing one so nothing leaks "exists, but not yours".
 *
 * This is the only enforcement there is: the project has no RLS policies and
 * no browser-side Supabase client, so authorization lives in these functions.
 *
 * `content_items.client_id` is denormalized alongside `cycle_id` (migration
 * 015) precisely so that ownership stays a single-table filter here instead of
 * a join back through `content_cycles`.
 */

/** An item plus its live assets, ordered by `position`. */
export interface ReviewItem extends ContentItemRecord {
  assets: ContentAssetRecord[];
}

/**
 * Items the client is not allowed to see yet.
 *
 * 'draft' is the un-released state. Release promotes 'draft' -> 'in_review',
 * so filtering it out here is what keeps a post Kelsey adds to an
 * already-released month invisible until she releases again.
 */
const CLIENT_HIDDEN_ITEM_STATUS = "draft";

/**
 * The one cycle currently out for review, or null.
 *
 * `status = 'in_review'` IS the visibility switch — a 'drafting' cycle is
 * Kelsey still building (or a month she unreleased), and a 'locked' one is
 * closed. Ordered newest-first and capped at one: the schema allows a client
 * to have several months released at once, and the queue is a single-month
 * surface, so the most recent month wins rather than the page rendering an
 * ambiguous merge.
 */
export async function fetchMyActiveCycle(
  clientId: string
): Promise<ContentCycleRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "in_review")
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ContentCycleRecord[];
  return rows[0] ?? null;
}

/**
 * The most recently closed month, for the between-cycles recap card
 * (spec §5.9, copy deck Screen 7).
 *
 * 'locked' is written by the Phase 7 deadline sweep and by Kelsey's manual
 * lock, neither of which exists yet — so this correctly returns null for now
 * and the page falls through to the "nothing released yet" state. The recap
 * branch is built rather than deferred because it is the same query and the
 * alternative is a client landing on an empty page the moment Phase 7 ships.
 */
export async function fetchMyLastClosedCycle(
  clientId: string
): Promise<ContentCycleRecord | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "locked")
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ContentCycleRecord[];
  return rows[0] ?? null;
}

/**
 * Every post in one of the client's cycles that they are allowed to see,
 * chronological, each with its live assets attached.
 *
 * Chronological because the queue mirrors the month: the client works forward
 * through the dates their posts go out. There is no "unreviewed first" sort —
 * a queue that reorders itself under someone as they work is disorienting, and
 * per-item status already marks what is left.
 */
export async function fetchMyReviewItems(
  clientId: string,
  cycleId: string
): Promise<ReviewItem[]> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("client_id", clientId)
    .eq("cycle_id", cycleId)
    .neq("status", CLIENT_HIDDEN_ITEM_STATUS)
    .order("scheduled_for", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ContentItemRecord[];
  if (rows.length === 0) return [];

  const assetsByItem = await fetchLiveAssetsByItem(rows.map((r) => r.id));
  return rows.map((row) => ({
    ...row,
    assets: assetsByItem.get(row.id) ?? [],
  }));
}

/**
 * The cycle one of the client's items belongs to, but ONLY when that cycle is
 * currently out for review. Null otherwise.
 *
 * Two gates, and both matter. `client_id` on the item read is ownership; the
 * cycle status is release state. A client owns their `drafting` items too, so
 * ownership alone would let a bookmarked URL open a post from a month Kelsey
 * is still building or has unreleased.
 *
 * Null is returned identically for every failure — no such item, someone
 * else's item, an unreleased cycle — so a caller can only ever answer "not
 * found" and nothing leaks the difference.
 */
export async function fetchMyReviewableCycleForItem(
  clientId: string,
  itemId: string
): Promise<ContentCycleRecord | null> {
  if (!itemId) return null;
  const supabase = getSupabaseServiceClient();

  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("cycle_id")
    .eq("id", itemId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  const item = itemData as { cycle_id: string } | null;
  if (!item) return null;

  const { data: cycleData, error: cycleError } = await supabase
    .from("content_cycles")
    .select("*")
    .eq("id", item.cycle_id)
    .eq("client_id", clientId)
    .eq("status", "in_review")
    .maybeSingle();
  if (cycleError) throw new Error(cycleError.message);
  return (cycleData as ContentCycleRecord | null) ?? null;
}

/**
 * How many posts were in a closed month — the recap card's count.
 *
 * Counts what the client could see, not every row, so a draft Kelsey left
 * behind in a locked month is not reported back to them as a post.
 */
export async function countMyCycleItems(
  clientId: string,
  cycleId: string
): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from("content_items")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("cycle_id", cycleId)
    .neq("status", CLIENT_HIDDEN_ITEM_STATUS);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Live assets for a set of items, keyed by item id, ordered by `position`.
 *
 * `replaced_at is null` matches the partial unique index that guarantees one
 * current asset per position; superseded rows are version history and never
 * render. Not exported and not ownership-checked on its own — every caller
 * above has already constrained its item ids to one client.
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
