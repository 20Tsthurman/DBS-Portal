import { describeStreamError, getVideoStatus } from "@/lib/stream";
import {
  getSupabaseServiceClient,
  type ContentAssetRecord,
} from "@/lib/supabase";

/**
 * SERVER ONLY. The processing -> ready/failed transition for Stream video
 * (spec §3.5b): upload completion and playability are separate events, so a
 * video asset row is minted 'processing' and something has to ask Cloudflare
 * whether that is still true. This module is that something.
 *
 * There is no webhook. Cloudflare can push a status change, but receiving one
 * means a public unauthenticated endpoint plus signature verification plus a
 * secret to rotate, for a transition that at 6-15 second clip lengths resolves
 * in seconds while Kelsey is looking at the panel. A poll she is already
 * paying for with an open tab is the smaller mechanism (see the build plan's
 * slice 2.4, which specifies `useVisibilityPolling` for exactly this).
 */

/**
 * Ceiling on how many assets one call may refresh.
 *
 * The caller is a panel showing one post's carousel, and Instagram's own
 * carousel limit is 20, so this cannot be hit by legitimate use. It exists so
 * a malformed body cannot turn one request into an unbounded fan-out of
 * Cloudflare API calls.
 */
export const MAX_REFRESH_ASSET_IDS = 20;

/**
 * The write half of a transition. Guarded on `status = 'processing'` so it is
 * a CONDITIONAL update, not a blind one — which is what makes concurrent
 * callers safe. Two polls that both observe 'ready' both try to write it; the
 * first matches the row, the second matches nothing and is a no-op rather
 * than a second write. More importantly, a poll that observed a stale
 * 'processing' can never clobber a 'failed' another call already recorded,
 * because by then the guard no longer matches.
 *
 * Returns the row as it now stands. When the guard matches nothing the row is
 * re-read rather than assumed: the caller is reporting state to a UI, and the
 * truth is whatever the winner wrote, not what this call computed.
 */
async function writeTransition(
  asset: ContentAssetRecord,
  next: {
    status: ContentAssetRecord["status"];
    error_reason: string | null;
    duration_seconds: number | null;
    width: number | null;
    height: number | null;
    bytes: number | null;
  }
): Promise<ContentAssetRecord> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from("content_assets")
    .update(next)
    .eq("id", asset.id)
    .eq("status", "processing")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return data as ContentAssetRecord;

  const { data: current, error: reloadErr } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", asset.id)
    .maybeSingle();
  if (reloadErr) throw new Error(reloadErr.message);

  // Null only if the row was deleted mid-flight — Kelsey removing the asset
  // while a poll was in the air. The pre-update copy is the honest answer;
  // the caller's next poll will simply not include it.
  return (current as ContentAssetRecord | null) ?? asset;
}

/**
 * Ask Cloudflare about one processing video and write what it says.
 *
 * `getVideoStatus` already collapses Cloudflare's seven-value vocabulary into
 * processing / ready / failed, so there is no vendor interpretation here —
 * only the mapping of a failure to prose (`describeStreamError`) and the write.
 *
 * A 'failed' is RECORDED, never swallowed. A video that will never encode has
 * to look different from one that is still working, or Kelsey watches a tile
 * spin forever on a clip that was rejected in the first few seconds.
 *
 * `error_reason` is written on every transition, not only on failure: the
 * `content_assets_error_reason_check` constraint from migration 016 requires a
 * reason to belong to a 'failed' row and nothing else, so moving to 'ready'
 * must clear it in the same statement.
 */
async function refreshOne(
  asset: ContentAssetRecord
): Promise<ContentAssetRecord> {
  const observed = await getVideoStatus(asset.external_id);

  if (observed.status === "processing") return asset;

  return writeTransition(asset, {
    status: observed.status,
    error_reason:
      observed.status === "failed" ? describeStreamError(observed) : null,
    duration_seconds: observed.durationSeconds,
    width: observed.width,
    height: observed.height,
    // Cloudflare's measured size once it has one; otherwise keep the size
    // declared at mint rather than blanking a column that was already right.
    bytes: observed.sizeBytes ?? asset.bytes,
  });
}

/**
 * Refresh every still-processing Stream asset among `assetIds` and return the
 * current row for ALL of them, in position order.
 *
 * Idempotent and safe to call repeatedly, which the poll driving it depends
 * on. Only rows that are BOTH provider='stream' AND status='processing' cost a
 * Cloudflare call — a ready video, a failed one, and every photo are returned
 * from Postgres untouched, so polling a settled panel is free on the vendor
 * side even if the client keeps asking.
 *
 * Calls fan out in parallel. They are independent GETs against different
 * video UIDs, and the list is capped at MAX_REFRESH_ASSET_IDS, so the fan-out
 * is bounded by construction.
 *
 * A Cloudflare read that THROWS leaves the row exactly as it was. This is
 * deliberate and it is the one judgment call in the module: `getVideoStatus`
 * throws identically for "this video does not exist" (a 404 — a real, terminal
 * failure) and "Cloudflare is having an outage" (a 5xx), and it does not
 * expose the status code to tell them apart. Marking a row 'failed' on a throw
 * would, during any vendor blip, tell Kelsey that every video she uploaded is
 * broken and push her into deleting good ones and re-uploading them — paying
 * twice for storage each time. A row left on 'processing' is the recoverable
 * error: the next poll fixes a blip on its own, and a genuinely absent video
 * stays visibly stuck and is removable from the tile. The throw is logged so
 * a persistently stuck asset is diagnosable.
 */
export async function refreshAssetStatuses(
  assetIds: string[]
): Promise<ContentAssetRecord[]> {
  if (assetIds.length === 0) return [];

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("content_assets")
    .select("*")
    .in("id", assetIds)
    .is("replaced_at", null)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const assets = (data ?? []) as ContentAssetRecord[];

  return Promise.all(
    assets.map(async (asset) => {
      if (asset.provider !== "stream" || asset.status !== "processing") {
        return asset;
      }
      try {
        return await refreshOne(asset);
      } catch (err) {
        console.error(
          "[content] stream status refresh failed",
          asset.id,
          asset.external_id,
          err
        );
        return asset;
      }
    })
  );
}
