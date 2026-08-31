import {
  CONTENT_ASSETS_BUCKET,
  createSignedDownloadUrls,
} from "@/lib/storage";
import { createPlaybackUrls } from "@/lib/stream";
import type { ContentAssetRecord } from "@/lib/supabase";

/**
 * SERVER ONLY. Mints signed URLs with the service-role client and the
 * Cloudflare signing key; nothing here may be imported into a client
 * component. `ReviewSlide` may be — it is a plain data type and crosses into
 * `PostMedia` as a prop.
 *
 * OWNERSHIP: like `./thumbs.ts`, this checks nothing itself and must only ever
 * be handed assets belonging to an item the caller has already constrained to
 * one client.
 */

/** One frame of a post's media. A single-asset post has exactly one. */
export interface ReviewSlide {
  assetId: string;
  kind: "video" | "image";
  /**
   * A photo's signed image URL, or a ready video's signed poster frame.
   * Null when there is nothing to show — the tile renders its error state
   * rather than a broken image.
   */
  url: string | null;
}

/**
 * Build the slides for ONE post, in `position` order.
 *
 * Photos are minted in one batched call so a five-slide carousel costs one
 * Supabase round trip rather than five.
 *
 * NOTE WHAT IS NOT MINTED HERE: the video player URL. Only the poster is,
 * because a playback token lives an hour and a page left open longer than
 * that would expand into a dead frame — and a cross-origin iframe cannot
 * report that it failed. The player URL is minted at press time instead, by
 * `createReviewPlaybackAction`. This is the same reasoning the owner-side
 * `createContentAssetPlaybackAction` documents, and it matters more here: a
 * client is far more likely than Kelsey to leave a tab open all afternoon.
 */
export async function buildReviewSlides(
  assets: ContentAssetRecord[]
): Promise<ReviewSlide[]> {
  const slides: ReviewSlide[] = [];
  const photoPaths: string[] = [];

  for (const asset of assets) {
    if (asset.provider === "supabase") photoPaths.push(asset.external_id);
  }

  let urlByPath = new Map<string, string | null>();
  if (photoPaths.length > 0) {
    try {
      urlByPath = await createSignedDownloadUrls(
        photoPaths,
        CONTENT_ASSETS_BUCKET
      );
    } catch {
      // Absorbed per-batch: every photo slide falls back to its error state
      // instead of the page failing to render at all.
    }
  }

  for (const asset of assets) {
    if (asset.provider === "stream") {
      let url: string | null = null;
      // Only a ready video has an encoded frame. A released month cannot hold
      // an unready one (the release gate blocks it), but an
      // unrelease/add/re-release window can.
      if (asset.status === "ready") {
        try {
          url = createPlaybackUrls(asset.external_id).posterUrl;
        } catch {
          url = null;
        }
      }
      slides.push({ assetId: asset.id, kind: "video", url });
      continue;
    }

    slides.push({
      assetId: asset.id,
      kind: "image",
      url: urlByPath.get(asset.external_id) ?? null,
    });
  }

  return slides;
}
