import { PORTAL_TIMEZONE, dateKeyInTimezone } from "@/lib/date";
import type {
  ContentCycleStatus,
  ContentItemStatus,
  Platform,
  PostFormat,
} from "@/lib/supabase";

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  pinterest: "Pinterest",
};

export const FORMAT_LABELS: Record<PostFormat, string> = {
  reel: "Reel",
  feed: "Feed",
  story: "Story",
  carousel: "Carousel",
};

export const PLATFORM_OPTIONS: Array<{ value: Platform; label: string }> = (
  Object.keys(PLATFORM_LABELS) as Platform[]
).map((value) => ({ value, label: PLATFORM_LABELS[value] }));

export const FORMAT_OPTIONS: Array<{ value: PostFormat; label: string }> = (
  Object.keys(FORMAT_LABELS) as PostFormat[]
).map((value) => ({ value, label: FORMAT_LABELS[value] }));

type Tone = "success" | "warning" | "danger" | "neutral" | "accent";

export function itemStatusToneFor(status: ContentItemStatus): Tone {
  switch (status) {
    case "approved":
      return "success";
    case "changes_requested":
      return "warning";
    case "in_review":
      return "accent";
    case "published":
      return "success";
    case "draft":
    default:
      return "neutral";
  }
}

export function itemStatusLabelFor(status: ContentItemStatus): string {
  switch (status) {
    case "in_review":
      return "In review";
    case "changes_requested":
      return "Changes requested";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "draft":
    default:
      return "Draft";
  }
}

export function cycleStatusToneFor(status: ContentCycleStatus): Tone {
  switch (status) {
    case "in_review":
      return "accent";
    case "locked":
      return "neutral";
    case "drafting":
    default:
      return "warning";
  }
}

export function cycleStatusLabelFor(status: ContentCycleStatus): string {
  switch (status) {
    case "in_review":
      return "In review";
    case "locked":
      return "Locked";
    case "drafting":
    default:
      return "Drafting";
  }
}

// `<input type="time">` wants a 24-hour "HH:MM", which none of the existing
// display formatters produce — `formatTimeInTimezone` returns "9:00 AM" and
// `hourOfDayInTimezone` returns a float. Read the wall clock in
// PORTAL_TIMEZONE rather than off the raw Date, or the value shifts by the
// host offset on a UTC server.
const timeInputFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PORTAL_TIMEZONE,
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/** "14:30" — PORTAL_TIMEZONE wall-clock HH:MM for a UTC instant. */
export function timeInputValueInTimezone(d: Date): string {
  const parts = timeInputFmt.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return `${map.hour ?? "00"}:${map.minute ?? "00"}`;
}

export function formatAssetCount(count: number): string {
  if (count === 0) return "—";
  return count === 1 ? "1 photo" : `${count} photos`;
}

/**
 * Today's PORTAL_TIMEZONE date key when it falls inside `monthKey`, otherwise
 * the first of that month. Seeds the item form so a new post always lands
 * inside its cycle's month, which the create action enforces server-side.
 */
export function defaultDateForMonth(monthKey: string): string {
  const today = dateKeyInTimezone(new Date());
  return today.slice(0, 7) === monthKey ? today : `${monthKey}-01`;
}
