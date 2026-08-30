import { createSignedDownloadUrl, CONTENT_ASSETS_BUCKET } from "@/lib/storage";
import { createPlaybackUrls } from "@/lib/stream";
import type { ContentAssetRecord } from "@/lib/supabase";

/**
 * SERVER ONLY. Mints signed URLs with the service-role client and the
 * Cloudflare signing key; nothing here may be imported into a client
 * component. It lives in `_lib/` rather than `_actions.ts` because both a
 * server action (`fetchContentAssetPreviewsAction`) and an API route
 * (`/api/owner/content/asset-status`) need it, and a `"use server"` module may
 * only export async functions — the type below could not live there alongside
 * a route importing it.
 *
 * The two callers returning the SAME shape is the point. The status poll
 * replaces the panel's preview list wholesale on every tick, so a field the
 * route computed differently from the action would flicker on screen once
 * every poll interval.
 */

/** One tile in the panel's media strip. */
export interface AssetPreview {
  id: string;
  position: number;
  kind: "video" | "image";
  status: "processing" | "ready" | "failed";
  /**
   * What to draw in the tile: a signed still for a photo, a signed Stream
   * poster frame for a ready video, and null for everything with no image —
   * a video that is still processing or has failed, or a photo whose object
   * has gone missing.
   *
   * A null is a PLACEHOLDER instruction, never an error. The tile still
   * renders, carrying `kind` and `status` instead of an image; dropping it
   * would make an uploaded video invisible while its row holds a carousel
   * slot, which reads as a lost upload and invites a second one into a
   * position that is already taken.
   */
  url: string | null;
  /**
   * Plain-language failure text from `describeStreamError`, already stored on
   * the row by the status poll. Non-null only when status is 'failed'.
   */
  errorReason: string | null;
}

/**
 * Build the panel tiles for a set of live asset rows, minting one signed URL
 * per asset that has something to show.
 *
 * A signing failure is absorbed per-asset rather than failing the batch: a
 * missing storage object or an unset Stream env var blanks ONE tile instead of
 * the whole strip, and the tile that loses its image still renders from `kind`
 * and `status` so the slot stays visible and deletable.
 *
 * Photo URLs and Stream tokens both live one hour. Nothing here schedules a
 * refresh — the panel reloads previews when an image fails to load, which
 * covers an expired URL and a transient network failure with one path.
 */
export async function buildAssetPreviews(
  assets: ContentAssetRecord[]
): Promise<AssetPreview[]> {
  const previews: AssetPreview[] = [];

  for (const asset of assets) {
    const base = {
      id: asset.id,
      position: asset.position,
      kind: asset.kind,
      status: asset.status,
      errorReason: asset.error_reason,
    };

    if (asset.provider === "stream") {
      // Only a READY video has a frame to show. A processing one has no
      // encoded output yet, and a failed one never will — asking Cloudflare
      // for either returns a 404 image that would render as a broken tile.
      //
      // Note that the poster URL carries a real playback token: Cloudflare
      // scopes a token to a video UID, not to an endpoint, so the same token
      // works for /iframe. Showing a signed thumbnail at all means putting a
      // playable credential on the page, which is inherent to the vendor's
      // design and acceptable here because this is an owner-only surface.
      if (asset.status !== "ready") {
        previews.push({ ...base, url: null });
        continue;
      }
      try {
        previews.push({
          ...base,
          url: createPlaybackUrls(asset.external_id).posterUrl,
        });
      } catch {
        previews.push({ ...base, url: null });
      }
      continue;
    }

    try {
      const url = await createSignedDownloadUrl(
        asset.external_id,
        `photo-${asset.position + 1}`,
        CONTENT_ASSETS_BUCKET
      );
      previews.push({ ...base, url });
    } catch {
      previews.push({ ...base, url: null });
    }
  }

  return previews;
}
