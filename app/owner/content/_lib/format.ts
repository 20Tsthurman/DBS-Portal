import { PORTAL_TIMEZONE, dateKeyInTimezone } from "@/lib/date";
import { shortDateLabelForDateKey } from "@/app/owner/calendar/_lib/timezone";
import type { RevisionCharge } from "@/lib/revisionBilling";
import type {
  ContentCycleStatus,
  ContentItemStatus,
  Platform,
  PostFormat,
  RevisionCategory,
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

/**
 * "14:30" (an `<input type="time">` value) → "2:30pm", matching
 * `formatShortTimeInTimezone`'s style. The display-direction counterpart of
 * `timeInputValueInTimezone`, for surfaces that show the form's LIVE value
 * rather than a stored instant — no Date and no timezone math, because the
 * input string already IS the wall clock.
 */
export function timeLabelFromInputValue(value: string): string {
  const [hRaw, mRaw] = value.split(":");
  const h24 = Number(hRaw);
  const mi = Number(mRaw);
  if (!Number.isFinite(h24) || !Number.isFinite(mi)) return value;
  const ampm = h24 >= 12 ? "pm" : "am";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return mi === 0 ? `${h12}${ampm}` : `${h12}:${String(mi).padStart(2, "0")}${ampm}`;
}

export function formatAssetCount(count: number): string {
  if (count === 0) return "—";
  return count === 1 ? "1 photo" : `${count} photos`;
}

/**
 * Kelsey's labels for the revision categories — house voice, deliberately NOT
 * imported from the client review surface. The client's labels are copy-deck
 * rows and the deck is client-scope; these are Kelsey's vocabulary over the
 * same enum, the same two-vocabularies arrangement the status labels use.
 * (They coincide today; the point is that a deck copy pass can never reword
 * Kelsey's screen, and vice versa.)
 */
export const REVISION_CATEGORY_LABELS: Record<RevisionCategory, string> = {
  clips: "Clips",
  caption: "Caption",
  music: "Music",
  pacing: "Pacing",
  text_overlay: "Text overlay",
  cover: "Cover",
  schedule: "Schedule",
  other: "Other",
};

/**
 * "0:12" — m:ss with the seconds floored, for a note's scrubber position.
 * Duplicated from the client review surface's formatter rather than imported:
 * owner code importing from `app/client/**` would invert the layering
 * convention, and six lines is cheaper than a neutral-lib move for two call
 * sites (the same trade lib/stream.ts made with requireEnv).
 */
export function formatTimecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Kelsey's label for one accrued revision charge: "Round 2" for a per-round
 * charge, "Round 2 · Instagram Reel, Oct 10" for a per-post one. Owner
 * vocabulary — the client-facing line description on the invoice is a
 * copy-deck string and lives with the invoice code, not here.
 */
export function revisionChargeLabel(
  charge: Pick<RevisionCharge, "roundNumber" | "billingMode" | "item">
): string {
  const round = `Round ${charge.roundNumber}`;
  if (charge.billingMode !== "per_item" || !charge.item) return round;
  const dateKey = dateKeyInTimezone(new Date(charge.item.scheduledFor));
  return `${round} · ${PLATFORM_LABELS[charge.item.platform]} ${
    FORMAT_LABELS[charge.item.format]
  }, ${shortDateLabelForDateKey(dateKey)}`;
}

/**
 * The four states a charge shows Kelsey, as a pill. "Pending" is the word
 * for an accrued charge that is not yet income and not yet billable — the
 * spec's word, and never "income", "revenue" or "earned" anywhere on these
 * surfaces (the business is cash-basis; income posts when the invoice is
 * paid, through the existing flow).
 *
 *   pending       — accrued, waiting on her accept or deny
 *   ready to bill — every request answered, offerable in the invoice panel
 *   on / paid     — stamped to a live invoice, named; green only once paid
 *   waived        — every request in the round denied; not billed
 */
export function revisionChargeStateFor(
  charge: Pick<RevisionCharge, "state" | "invoice">
): { label: string; tone: Tone } {
  if (charge.invoice) {
    const number = charge.invoice.number ?? "an invoice";
    return charge.invoice.status === "paid"
      ? { label: `Paid · ${number}`, tone: "success" }
      : { label: `On ${number}`, tone: "neutral" };
  }
  switch (charge.state) {
    case "ready":
      return { label: "Ready to bill", tone: "accent" };
    case "waived":
      return { label: "Waived", tone: "neutral" };
    case "pending":
    default:
      return { label: "Pending", tone: "neutral" };
  }
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
