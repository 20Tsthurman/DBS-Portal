import {
  formatMonthLabel,
  shortDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { platformLabel } from "@/app/client/review/_lib/format";
import { dateKeyInTimezone } from "@/lib/date";
import type { RevisionCharge } from "@/lib/revisionBilling";

/**
 * An accrued revision charge as the invoice panel sees it: one line item
 * waiting to be added, with the description and amount the server will write.
 *
 * THE DESCRIPTION IS CLIENT-FACING. It lands on the invoice PDF, the receipt
 * PDF, and the client's invoice list, so it is a copy-deck string ("Invoice
 * line items", rows added 2026-09-04) and is built here — server-side, from
 * the charge — never typed or edited in the panel. The panel shows it; the
 * create and update actions rebuild it from the same function before writing,
 * so what Kelsey saw and what the client reads cannot differ.
 *
 * `platformLabel` is imported from the client review surface on purpose: the
 * deck row says "Instagram Reel, Oct 10" in the CLIENT's vocabulary (Screen
 * 2's label, where `feed` reads "Post"), and duplicating a deck string is the
 * one thing worse than an owner module importing a pure client formatter.
 */
export interface RevisionChargeOption {
  /** The charge's stable key — the panel's React key and its "already added" check. */
  key: string;
  /** Every round row the charge stands on; the stamp targets all of them. */
  roundIds: string[];
  /** The deck's line-item description, exactly as it will be written. */
  description: string;
  /** The round's snapshotted price — the amount the client consented to. */
  amount: number;
}

/**
 * Copy deck, "Invoice line items":
 *
 *   per round — "Content revisions · Round 2 · October 2026"
 *   per post  — "Content revisions · Round 2 · Instagram Reel, Oct 10"
 *
 * A per-post charge whose post is somehow missing (rounds cascade with their
 * items, so this is defensive) falls back to the per-round shape rather than
 * printing "undefined" on a PDF.
 */
export function describeRevisionCharge(
  charge: Pick<RevisionCharge, "billingMode" | "roundNumber" | "monthKey" | "item">
): string {
  const lead = `Content revisions · Round ${charge.roundNumber}`;
  if (charge.billingMode === "per_item" && charge.item) {
    const dateKey = dateKeyInTimezone(new Date(charge.item.scheduledFor));
    return `${lead} · ${platformLabel(
      charge.item.platform,
      charge.item.format
    )}, ${shortDateLabelForDateKey(dateKey)}`;
  }
  return `${lead} · ${formatMonthLabel(charge.monthKey)}`;
}

export function revisionChargeOption(
  charge: RevisionCharge
): RevisionChargeOption {
  return {
    key: charge.key,
    roundIds: charge.roundIds,
    description: describeRevisionCharge(charge),
    amount: charge.amount,
  };
}

/** Set equality on round ids — how a submitted line item finds its charge. */
export function sameRoundIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
