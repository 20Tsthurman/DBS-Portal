import {
  CONTENT_ASSETS_BUCKET,
  createSignedDownloadUrls,
} from "@/lib/storage";
import { createPlaybackUrls } from "@/lib/stream";
import type { ContentItemWithAssets } from "./queries";

/**
 * SERVER ONLY — mints signed URLs with the service-role client and the
 * Cloudflare signing key; nothing here may be imported into a client
 * component. (Same posture as `./assetPreviews.ts`, which serves the item
 * panel's full media strip; this module serves the month grid, which needs
 * exactly one thumbnail per item.)
 *
 * One thumb per item: the FIRST live asset, which `fetchItemsForCycles`
 * already ordered by `position`. Photos are minted in a single batched
 * `createSignedUrls` call — the all-clients month can hold ~100 items, and
 * one Supabase round-trip per photo would put the page render at the mercy
 * of 100 sequential API calls. Stream poster URLs cost nothing extra: token
 * signing is local and synchronous.
 *
 * Failures are absorbed per-item, mirroring `buildAssetPreviews`: a signing
 * failure blanks ONE tile (null = the muted occupied-slot placeholder), and
 * a whole-batch photo failure blanks the photo tiles without failing the
 * page.
 */
export async function buildCalendarThumbUrls(
  items: ContentItemWithAssets[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const photoPaths: Array<{ itemId: string; path: string }> = [];

  for (const item of items) {
    const first = item.assets[0];
    if (!first) continue; // no media — the mapper renders a no-thumb tile

    if (first.provider === "stream") {
      // Only a READY video has a poster frame; processing has no encoded
      // output yet and failed never will (see buildAssetPreviews).
      if (first.status !== "ready") {
        out.set(item.id, null);
        continue;
      }
      try {
        out.set(item.id, createPlaybackUrls(first.external_id).posterUrl);
      } catch {
        out.set(item.id, null);
      }
      continue;
    }

    photoPaths.push({ itemId: item.id, path: first.external_id });
  }

  if (photoPaths.length > 0) {
    let urlByPath = new Map<string, string | null>();
    try {
      urlByPath = await createSignedDownloadUrls(
        photoPaths.map((p) => p.path),
        CONTENT_ASSETS_BUCKET
      );
    } catch {
      // Whole-batch failure: every photo tile falls back to the placeholder
      // rather than the page 500ing over thumbnails.
    }
    for (const { itemId, path } of photoPaths) {
      out.set(itemId, urlByPath.get(path) ?? null);
    }
  }

  return out;
}
