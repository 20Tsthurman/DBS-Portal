import { dateKeyInTimezone } from "@/lib/date";
import type {
  ContentAssetRecord,
  ContentItemStatus,
  Platform,
  PostFormat,
} from "@/lib/supabase";
import type { ContentItemWithAssets } from "./queries";

/**
 * The content calendar's event shape — the fourth mapper's output, written in
 * the same style as `shootToEvent` / `timeBlockToEvent` / `externalEventToEvent`
 * (`app/owner/calendar/_lib/queries.ts`) but DELIBERATELY not part of
 * `CalendarEvent` and never assembled into `fetchEventsInRange`: merging it
 * there would put every draft post onto the live owner calendar. The content
 * calendar is fed from the cycle-scoped fetches in `./queries.ts` instead.
 *
 * Satisfies `MonthGridEvent` (`id` + `dateKey`), which is all `MonthGrid`
 * reads; everything else is consumed by the content calendar's tile renderer.
 *
 * This module is pure and client-safe — the type crosses into the client
 * `ContentCalendar` component. Signed thumbnail URLs are minted server-side
 * in `./calendarThumbs.ts` and passed in.
 */

/** What the day-cell tile draws for one post. */
export interface ContentCalendarThumb {
  kind: ContentAssetRecord["kind"];
  status: ContentAssetRecord["status"];
  /**
   * Signed photo URL or Stream poster URL. Null is a PLACEHOLDER
   * instruction, never an error (same contract as `AssetPreview.url`): the
   * tile still renders as a muted occupied slot so the post stays visible on
   * the calendar while its video transcodes or after a signing failure.
   */
  url: string | null;
}

export interface ContentCalendarEvent {
  /** "content_item:<uuid>" — same table-prefix convention as the calendar mappers. */
  id: string;
  itemId: string;
  clientId: string;
  clientName: string;
  /** YYYY-MM-DD in PORTAL_TIMEZONE — the day the post is scheduled on. */
  dateKey: string;
  scheduledFor: Date;
  platform: Platform;
  format: PostFormat;
  status: ContentItemStatus;
  /** Live assets on the item (carousels have several; the tile shows the first). */
  assetCount: number;
  /** First live asset, or null for a post with no media yet. */
  thumb: ContentCalendarThumb | null;
}

/**
 * Map one content item (with its live assets) to a calendar event.
 * `thumbUrlByItemId` comes from `buildCalendarThumbUrls` — a missing entry
 * means "no image", which renders as the occupied-slot placeholder.
 */
export function contentItemToEvent(
  item: ContentItemWithAssets,
  thumbUrlByItemId: Map<string, string | null>
): ContentCalendarEvent {
  const scheduledFor = new Date(item.scheduled_for);
  const firstAsset = item.assets[0] ?? null;
  return {
    id: `content_item:${item.id}`,
    itemId: item.id,
    clientId: item.client_id,
    clientName: item.client_name,
    dateKey: dateKeyInTimezone(scheduledFor),
    scheduledFor,
    platform: item.platform,
    format: item.format,
    status: item.status,
    assetCount: item.assets.length,
    thumb: firstAsset
      ? {
          kind: firstAsset.kind,
          status: firstAsset.status,
          url: thumbUrlByItemId.get(item.id) ?? null,
        }
      : null,
  };
}
