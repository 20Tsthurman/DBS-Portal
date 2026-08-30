import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import { buildAssetPreviews } from "@/app/owner/content/_lib/assetPreviews";
import {
  MAX_REFRESH_ASSET_IDS,
  refreshAssetStatuses,
} from "@/app/owner/content/_lib/assetStatus";

/**
 * The processing -> ready/failed transition, driven by the composer's poll
 * (spec §3.5b). Owner-only: this is a building surface, and nothing
 * client-facing reads it.
 *
 * POST rather than GET because it WRITES — it asks Cloudflare about every
 * asset still marked processing and records what it hears. Repeat calls are
 * safe by construction; see `refreshAssetStatuses`.
 *
 * Returns the full `AssetPreview[]` for the ids it was given rather than a
 * bare status list, so a video that just turned ready arrives already carrying
 * its signed poster and player URL. The alternative — returning statuses and
 * making the client re-fetch previews on every change — costs a second round
 * trip at the exact moment the UI is trying to look instant, and gives the
 * panel two differently-built versions of the same shape to reconcile.
 */
export async function POST(request: Request) {
  const authError = await requireOwnerApi();
  if (authError) return authError;

  let assetIds: string[];
  try {
    const body = (await request.json()) as { assetIds?: unknown };
    if (!Array.isArray(body.assetIds)) {
      return NextResponse.json(
        { error: "assetIds must be an array" },
        { status: 400 }
      );
    }
    // De-duplicated: the cap is a fan-out guard, and a body of one id repeated
    // twenty times should not consume it.
    assetIds = Array.from(
      new Set(
        body.assetIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0
        )
      )
    );
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (assetIds.length > MAX_REFRESH_ASSET_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_REFRESH_ASSET_IDS} assets per request` },
      { status: 400 }
    );
  }

  try {
    const assets = await refreshAssetStatuses(assetIds);
    const previews = await buildAssetPreviews(assets);
    return NextResponse.json({ previews });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to refresh asset status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
