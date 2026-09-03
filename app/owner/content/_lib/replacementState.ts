import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
} from "@/lib/supabase";

/**
 * SERVER ONLY — reads with the service-role client. The accept flow's view of
 * one item's replaceable videos and any staged replacement already uploaded
 * (Phase 6, slice 6.1).
 *
 * Lives in `_lib/` on the `revisionRequests` precedent: the types below cross
 * into the client component that renders them (`ReplacementSection`), which a
 * `"use server"` module cannot export.
 *
 * STAGED ROWS ARE FETCHED BY `replaces_asset_id IS NOT NULL` — the explicit
 * marker from migration 017, never by inference from `replaced_at`. This
 * query is the reason the marker is a column: an abandoned replacement (a
 * mint whose upload stalled, a compare Kelsey walked away from) is invisible
 * to every live-asset read by design, and this is the ONE read that keeps it
 * discoverable and removable instead of billing Stream storage silently.
 *
 * ALL staged rows are returned, not just the newest. Two can exist for one
 * target — the mint's existence check is app-layer, so a double-press race
 * can slip a second one through — and hiding either would orphan its video.
 * The section renders every row it gets; each carries its own Remove.
 */

/** One live video on the item that a replacement could target. */
export interface ReplacementTarget {
  assetId: string;
  /** 0-based carousel position — the section labels it "Video N" as N+1. */
  position: number;
}

/** One staged (uploaded-but-not-swapped) replacement row. */
export interface StagedReplacement {
  assetId: string;
  /** The live asset this replacement supersedes on accept. Null only if that
   * asset was deleted out from under it (the FK is SET NULL) — still listed,
   * still removable, no longer usable. */
  targetAssetId: string | null;
  status: "processing" | "ready" | "failed";
  /** Plain-language encode failure from the row; non-null only on 'failed'. */
  errorReason: string | null;
}

export interface ReplacementState {
  targets: ReplacementTarget[];
  staged: StagedReplacement[];
}

/**
 * One query, partitioned in memory — an item holds a handful of asset rows.
 * Targets are the item's LIVE Stream videos in position order; staged rows
 * are everything carrying the marker, oldest first so a leftover from an
 * earlier attempt sits above the one Kelsey is working with now.
 */
export async function fetchReplacementState(
  itemId: string
): Promise<ReplacementState> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .eq("content_item_id", itemId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ContentAssetRecord[];

  const targets = rows
    .filter(
      (row) =>
        row.replaced_at === null &&
        row.provider === "stream" &&
        row.kind === "video"
    )
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ assetId: row.id, position: row.position }));

  const staged = rows
    .filter((row) => row.replaces_asset_id !== null)
    .map((row) => ({
      assetId: row.id,
      targetAssetId: row.replaces_asset_id,
      status: row.status,
      errorReason: row.error_reason,
    }));

  return { targets, staged };
}
