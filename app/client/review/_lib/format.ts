import {
  shortDateLabelForDateKey,
  weekdayForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import {
  CONTENT_AUTO_ACTOR,
  type ContentItemRecord,
  type ContentItemStatus,
  type Platform,
  type PostFormat,
} from "@/lib/supabase";
import {
  PILL_APPROVED,
  PILL_KEPT_AS_PLANNED,
  PILL_NEEDS_REVIEW,
  PILL_WITH_KELSEY,
} from "./copy";

type Tone = "success" | "warning" | "danger" | "neutral" | "accent";

/**
 * Display vocabulary for the client side. Deliberately NOT shared with
 * `app/owner/content/_lib/format.ts`, which speaks Kelsey's language: it
 * renders 'in_review' as "In review" and `feed` as "Feed". The client sees
 * "Needs your review" and "Instagram Post" for the same rows.
 *
 * Two vocabularies over one enum is the point, not duplication to be cleaned
 * up later — every label below is a copy-deck string and the owner labels are
 * not.
 */

/** Copy deck, "Platform labels": "Instagram Reel", "Facebook Post". */
const CLIENT_PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  pinterest: "Pinterest",
};

/**
 * `feed` reads as "Post", not the owner's "Feed" — the deck's examples are
 * "Instagram Post" and "Instagram Carousel".
 *
 * `story` is the one label the deck does not show. "Story" is the platform's
 * own word for it, the same way "Reel" is, so it is used here rather than
 * invented prose — flagged for a copy pass.
 */
const CLIENT_FORMAT_LABELS: Record<PostFormat, string> = {
  reel: "Reel",
  feed: "Post",
  story: "Story",
  carousel: "Carousel",
};

/** "Instagram Reel" — the deck's one-line platform + format label. */
export function platformLabel(
  platform: Platform,
  format: PostFormat
): string {
  return `${CLIENT_PLATFORM_LABELS[platform]} ${CLIENT_FORMAT_LABELS[format]}`;
}

/**
 * Whether this post is still waiting on the client. The single source of the
 * count math, the row action, and the pill — so "8 posts still need your
 * review" can never disagree with the number of rows showing Review.
 */
export function needsClientReview(status: ContentItemStatus): boolean {
  return status === "in_review";
}

export interface StatusPillSpec {
  label: string;
  tone: Tone;
}

/**
 * Copy deck, "Status pills". Four states are representable since Phase 6:
 *
 *   in_review                    -> "Needs your review", mauve accent
 *   changes_requested            -> "With Kelsey", neutral
 *   changes_requested + denied   -> "Kept as planned", neutral
 *   approved/published           -> "Approved", green success
 *
 * `requestDenied` is a second dimension, not a status: deny writes nothing to
 * `content_items` (migration 017's design), so a denied item still reads
 * 'changes_requested' and the pill derives from the item's LATEST submitted
 * round being 'denied'. Callers get that from `fetchMyDeniedItemIds`.
 *
 * The auto-approved row meta ("Approved automatically · Sept 25") is not a
 * fifth pill: the pill stays "Approved" and the meta renders under it, from
 * `wasAutoApproved` and `shortMonthDayLabelForDateKey` below — an approved
 * post is approved, and who approved it is the smaller fact.
 *
 * 'draft' never reaches this function — the client query filters it out — but
 * it falls through to the neutral pill rather than throwing, because a status
 * pill is not worth a 500.
 */
export function statusPillFor(
  status: ContentItemStatus,
  requestDenied = false
): StatusPillSpec {
  switch (status) {
    case "in_review":
      return { label: PILL_NEEDS_REVIEW, tone: "accent" };
    case "changes_requested":
      return requestDenied
        ? { label: PILL_KEPT_AS_PLANNED, tone: "neutral" }
        : { label: PILL_WITH_KELSEY, tone: "neutral" };
    case "approved":
    case "published":
      return { label: PILL_APPROVED, tone: "success" };
    default:
      return { label: PILL_WITH_KELSEY, tone: "neutral" };
  }
}

/**
 * What the "Post" column shows: the first line of the caption, or "Post 5".
 *
 * `content_items.caption` is nullable and was never required by the owner
 * form, so a real month can hold posts with no caption at all. The positional
 * fallback matches Screen 2's "Post 5 of 12", so a post identified as "Post 5"
 * in the queue is called "Post 5" when opened.
 *
 * Only the first line is used: a caption can run 5,000 characters with
 * hashtags, and the whole thing in a table cell would bury every other row.
 */
export function postLabel(
  caption: string | null,
  positionInQueue: number
): string {
  const firstLine = (caption ?? "").split("\n")[0]?.trim() ?? "";
  if (firstLine === "") return `Post ${positionInQueue}`;
  return firstLine;
}

/**
 * Only formatter in the review surface with a local weekday table:
 * `timezone.ts` does not export its name arrays, and the deck's Screen 3
 * context line is the one place needing "Saturday, Oct 10" — long weekday,
 * SHORT month. Composed from the exported `weekdayForDateKey` +
 * `shortDateLabelForDateKey` ("Oct 10") so only the weekday half is local.
 */
const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "Saturday, Oct 10" — deck Screen 3's context-line date shape. */
export function shortWeekdayDateLabelForDateKey(dateKey: string): string {
  const weekday = WEEKDAY_LONG[weekdayForDateKey(dateKey)] ?? "";
  return `${weekday}, ${shortDateLabelForDateKey(dateKey)}`;
}

/**
 * The deck's month abbreviations for the auto-approved row meta ("Sept 25",
 * "Status pills"). "Sept" is not `timezone.ts`'s "Sep", so this is a fourth
 * date shape with its own table (decided 2026-09-04: the deck wrote Sept and
 * the deck governs). AP style without the periods — the one common
 * convention that yields "Sept": months of five letters or fewer are spelled
 * out, the rest cut to three, September to four.
 */
const MONTH_AP = [
  "Jan",
  "Feb",
  "March",
  "April",
  "May",
  "June",
  "July",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
];

/** "Sept 25" — the auto-approved row meta's date. No weekday, no year. */
export function shortMonthDayLabelForDateKey(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${MONTH_AP[m - 1] ?? ""} ${d}`;
}

/**
 * Approved by the lock rather than by the client. The row meta and Screen
 * 5's auto state both key on this — and on nothing else, because
 * `approved_by` is free text and the lock is its only writer of 'auto'.
 */
export function wasAutoApproved(
  item: Pick<ContentItemRecord, "status" | "approved_by">
): boolean {
  return (
    (item.status === "approved" || item.status === "published") &&
    item.approved_by === CONTENT_AUTO_ACTOR
  );
}

/**
 * "0:12" — a scrubber position the way the deck's moments button says it.
 * m:ss with the seconds floored: 12.7s of playback is a note "at 0:12", and
 * the stored `timestamp_seconds` keeps the precise value — this is display
 * only. Clips are capped at 120s (lib/stream.ts), so no hours form is needed.
 */
export function formatTimecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
