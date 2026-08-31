import {
  CONTENT_ASSETS_BUCKET,
  createSignedDownloadUrls,
} from "@/lib/storage";
import { createPlaybackUrls } from "@/lib/stream";
import type { ReviewItem } from "./queries";

/**
 * SERVER ONLY. Mints signed URLs with the service-role client and the
 * Cloudflare signing key; nothing here may be imported into a client
 * component. Sibling of `app/owner/content/_lib/calendarThumbs.ts` rather than
 * a shared extraction — that module lives under `app/owner/**`, which a client
 * surface should not import from, and this one has a different ownership story
 * (below).
 *
 * OWNERSHIP: this function performs no check of its own, and must never be
 * called with items from anywhere but `fetchMyReviewItems`, which constrains
 * every row to one client (Pattern A). `createPlaybackUrls` says the same
 * thing about itself — handing it a UID unlocks that video for an hour.
 *
 * A NOTE ON THE STREAM POSTER, because the owner-side version of this comment
 * justifies it differently. A signed poster URL carries a real playback token,
 * and Cloudflare scopes a token to a video UID rather than to an endpoint — so
 * rendering a thumbnail puts a playable credential on the page. `assetPreviews`
 * accepts that "because this is an owner-only surface". That reasoning does
 * not transfer, so here is the one that does: the token unlocks exactly the
 * video this client is being shown and is entitled to watch. It grants nothing
 * they could not already reach by opening the post. What would NOT be
 * acceptable is minting a poster for an item the ownership filter did not
 * cover, which is why the paragraph above is a hard requirement and not a
 * preference.
 */

/**
 * One thumbnail per item — the first live asset, already ordered by
 * `position`.
 *
 * A null value is a PLACEHOLDER INSTRUCTION, never an error: the tile still
 * renders, so a post with a still-processing video keeps its place in the
 * queue instead of vanishing. (A released month cannot contain one — the
 * release gate blocks on it — but an unrelease/add/re-release window can, and
 * a queue that silently drops rows is worse than a muted tile.)
 *
 * Photos are minted in one batched call. A month is ~20 posts; one Supabase
 * round trip each would put the page render behind twenty sequential API
 * calls. Stream posters cost nothing extra — token signing is local and
 * synchronous.
 */
export async function buildReviewThumbUrls(
  items: ReviewItem[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const photoPaths: Array<{ itemId: string; path: string }> = [];

  for (const item of items) {
    const first = item.assets[0];
    if (!first) continue;

    if (first.provider === "stream") {
      // Only a READY video has an encoded frame to show; asking Cloudflare
      // for a processing or failed one returns a 404 image, which renders as
      // a broken tile.
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
      // Whole-batch failure blanks the photo tiles. The queue is a list of
      // posts to act on, not a gallery — it must still render.
    }
    for (const { itemId, path } of photoPaths) {
      out.set(itemId, urlByPath.get(path) ?? null);
    }
  }

  return out;
}
