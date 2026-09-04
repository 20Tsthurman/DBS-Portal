import type {
  ContentBillingMode,
  InvoiceStatus,
  Platform,
  PostFormat,
  RevisionRoundRecord,
} from "@/lib/supabase";

/**
 * Revision billing — the pure decisions behind Phase 8 (spec §6).
 *
 * THIS MODULE TALKS TO NOTHING. No Supabase, no React, no dates. Every
 * function here is a total function over plain values, which is what makes it
 * the one place in the feature worth pinning hard with tests: a wrong branch
 * here is a charge a client never consented to, or a charge Kelsey never
 * collects, and neither is visible until an invoice goes out.
 *
 * Lives in neutral `lib/` because both surfaces read it — the client submit
 * action decides a round's charge with `computeRoundCharge`, and the owner
 * accrual read groups the results — and the house convention is that shared
 * code moves here rather than one surface importing from the other.
 *
 * THE TWO RULES EVERYTHING BELOW ENCODES:
 *
 *   1. A round's charge is decided ONCE, at the client's commit, from the
 *      cycle's settings at that instant, and written onto the round row as
 *      `is_billable` + `price` (migration 019's CHECK ties the two together).
 *      Nothing ever re-derives a sent round's charge from the cycle's current
 *      settings — so a price Kelsey sets today cannot reach a round the client
 *      sent last week, and every round sent before Phase 8 stays free forever.
 *
 *   2. In `per_round` billing there is ONE charge per round per cycle. The
 *      first billable submission of a round number in the cycle opens it and
 *      carries the money; every later post in that round is written FREE with
 *      no marker of any kind (decided 2026-09-04). "Already covered" is
 *      derived at read time from the opener's existence, never from anything
 *      on the covered row. The obvious marker, price 0, is ruled out because
 *      0 is reserved at the cycle level to mean "billing off for this month".
 */

// ---------------------------------------------------------------------------
// The charge decision — one round, at the moment the client sends it
// ---------------------------------------------------------------------------

export interface RoundBillingInput {
  /** The item's `current_round` — the round the client is about to send. */
  roundNumber: number;
  /** `content_cycles.included_rounds`. Rounds at or below this are free. */
  includedRounds: number;
  /**
   * `content_cycles.extra_round_price`. NULL or 0 (or anything not above
   * zero) means billing is OFF for the cycle: no dialog, no charge.
   */
  extraRoundPrice: number | null;
  billingMode: ContentBillingMode;
  /**
   * `per_round` only: a billable SUBMITTED round of this number already
   * exists in the cycle, opened by another post. Ignored in `per_item`, where
   * every revised post is its own charge. The caller reads this under the
   * standing rule — `submitted_at IS NOT NULL`, always.
   */
  roundAlreadyOpenInCycle: boolean;
}

/**
 * What a submission means for the client's money. Three states, and the
 * client-facing copy has one row for each (copy deck, Screens 3, 4, 5 and 9):
 *
 *   included — no charge: the round is within `included_rounds`, or billing
 *              is off for the cycle. No consent dialog.
 *   covered  — no charge for THIS post: `per_round`, and another post already
 *              opened this round's charge. The dialog shows the covered copy
 *              and no amount.
 *   charge   — this submission carries `price`. The Screen 9 consent dialog
 *              names the round and the amount before anything is sent.
 */
export type RoundBilling =
  | { kind: "included" }
  | { kind: "covered" }
  | { kind: "charge"; price: number };

/**
 * Whether a round number is priced at all under the cycle's settings — the
 * part of the decision that needs no database read. False means "included",
 * whatever the mode and whatever other posts have done: a round within the
 * included count, or a cycle with no price (null, 0, or anything not above
 * zero), is free for every post.
 *
 * Exposed on its own so the submit action can skip the opener read entirely
 * when the answer is already no — a round-1 submit should not cost a query
 * about charges that cannot exist.
 */
export function isRoundPriced(
  input: Pick<
    RoundBillingInput,
    "roundNumber" | "includedRounds" | "extraRoundPrice"
  >
): boolean {
  if (input.roundNumber <= input.includedRounds) return false;
  if (input.extraRoundPrice === null) return false;
  // `> 0` rather than `!== 0`: a negative or NaN price is not a price. The
  // cycle editor refuses both, but this is the money function and it does
  // not trust its callers to have been the editor.
  if (!(input.extraRoundPrice > 0)) return false;
  return true;
}

/**
 * THE MONEY FUNCTION. Decides what one submission costs.
 *
 * Read in order: is the round priced at all; if so, in `per_round`, has
 * another post already opened it; otherwise it is a charge at the cycle's
 * price as it stands right now. That price is what gets snapshotted onto the
 * row — the caller must not substitute a later read of the cycle.
 *
 * The same function backs the consent dialog (what the client is shown) and
 * the commit (what is written), fed the same inputs, so the two cannot
 * disagree. Where they could drift — a concurrent opener landing between the
 * dialog and the commit — the drift is one-directional: the commit's read
 * sees the new opener and this post becomes `covered`, so the client is never
 * charged more than the dialog showed. Only ever less.
 */
export function computeRoundCharge(input: RoundBillingInput): RoundBilling {
  if (!isRoundPriced(input)) return { kind: "included" };
  if (input.billingMode === "per_round" && input.roundAlreadyOpenInCycle) {
    return { kind: "covered" };
  }
  // `isRoundPriced` has established the price is a number above zero.
  return { kind: "charge", price: input.extraRoundPrice as number };
}

/**
 * The two columns the commit UPDATE writes, in the exact shape migration
 * 019's `revision_rounds_billable_price_check` demands: a charge carries its
 * amount, and everything else carries `false` and `null`. Included and
 * covered rows are indistinguishable here BY DESIGN — see rule 2 in the module
 * header.
 */
export type RoundChargeColumns =
  | { is_billable: false; price: null }
  | { is_billable: true; price: number };

export const FREE_ROUND_COLUMNS: RoundChargeColumns = {
  is_billable: false,
  price: null,
};

export function roundChargeColumns(billing: RoundBilling): RoundChargeColumns {
  if (billing.kind === "charge") {
    return { is_billable: true, price: billing.price };
  }
  return FREE_ROUND_COLUMNS;
}

// ---------------------------------------------------------------------------
// Amount formatting — the deck's rule
// ---------------------------------------------------------------------------

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DOLLARS_AND_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "$75", and "$62.50" only when there are cents to show — never "$75.00".
 * Confirmed as a copy-deck rule 2026-09-04, and used on the owner surfaces
 * too so one amount never renders two ways. Rounds to the cent first, so a
 * float artefact such as 74.99999 reads as the $75 it is.
 */
export function formatChargeAmount(amount: number): string {
  const cents = Math.round(amount * 100);
  const dollars = cents / 100;
  return cents % 100 === 0
    ? WHOLE_DOLLARS.format(dollars)
    : DOLLARS_AND_CENTS.format(dollars);
}

// ---------------------------------------------------------------------------
// The read side — from flagged rows to charges Kelsey can see and bill
// ---------------------------------------------------------------------------

export type RoundStatus = RevisionRoundRecord["status"];

/**
 * Where a charge stands, from the statuses of the rounds it is judged over:
 *
 *   waived   — every round in the group was denied. Spec §6.1: "a round in
 *              which every item was denied by Kelsey is not billed." Never
 *              offered, never shown as pending.
 *   pending  — at least one round is still open. The charge has accrued (the
 *              client sent a billable round) and Kelsey sees it as pending,
 *              but it cannot be offered for an invoice yet: the exemption
 *              above cannot be known until she has answered everything.
 *   ready    — everything answered, and not everything denied. Offerable.
 */
export type RoundGroupState = "waived" | "pending" | "ready";

/**
 * The fully-denied exemption and the not-yet-answered hold, over ONE group.
 *
 * In `per_round` the group is every submitted round with the charge's round
 * number in the charge's cycle — the opener AND every covered post. The
 * opener's own status is irrelevant on its own (decided 2026-09-04): if
 * Kelsey denies the opener but accepts the rest, the batch was revised and
 * the round bills. This is why the predicate `is_billable AND
 * status = 'addressed'` on the charge row, which migration 017's comment
 * anticipated, is WRONG for per_round and must not be reintroduced.
 *
 * In `per_item` the group is the one row, and the same function gives the
 * per-item answer: a denied post was not revised and is not billed.
 *
 * An empty group is not a charge and answers "waived" — the no-bill default.
 */
export function evaluateRoundGroup(statuses: RoundStatus[]): RoundGroupState {
  if (statuses.length === 0) return "waived";
  if (statuses.every((status) => status === "denied")) return "waived";
  if (statuses.some((status) => status === "open")) return "pending";
  return "ready";
}

/** The cycle columns the grouping needs. */
export interface ChargeCycleRow {
  id: string;
  client_id: string;
  /** YYYY-MM-DD, the first of the month. */
  month: string;
  billing_mode: ContentBillingMode;
}

/** The item columns the grouping needs — the per_item line description reads the post. */
export interface ChargeItemRow {
  id: string;
  cycle_id: string;
  platform: Platform;
  format: PostFormat;
  scheduled_for: string;
}

/** The round columns the grouping needs. `price` already coerced to a number. */
export interface ChargeRoundRow {
  id: string;
  content_item_id: string;
  round_number: number;
  is_billable: boolean;
  price: number | null;
  status: RoundStatus;
  submitted_at: string | null;
  invoice_id: string | null;
}

/** The invoice columns the grouping needs, for every invoice a round points at. */
export interface ChargeInvoiceRow {
  id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  inactive_at: string | null;
}

/**
 * One accrued revision charge — the unit Kelsey sees as pending and adds to
 * an invoice as one line item.
 */
export interface RevisionCharge {
  /**
   * Stable identity for keys and diffing: `${cycleId}:${roundNumber}` in
   * per_round, the round row id in per_item.
   */
  key: string;
  cycleId: string;
  clientId: string;
  /** YYYY-MM — the content month. */
  monthKey: string;
  roundNumber: number;
  billingMode: ContentBillingMode;
  amount: number;
  /**
   * Every round row the charge stands on. In per_round that is every OPENER
   * of the group — normally one; a same-instant race can produce two, and
   * they bill ONCE at one amount (the earliest opener's). In per_item it is
   * the one row. Stamped together at invoice-build time so none reappears.
   */
  roundIds: string[];
  state: RoundGroupState;
  /**
   * The LIVE invoice this charge is on, or null when unbilled. A stamp that
   * points at an inactive invoice does not count as billed (decided
   * 2026-09-04): a superseded or mistaken invoice releases its charges back
   * to the pool, and re-adding moves the stamp. Paid invoices cannot go
   * inactive, so a paid charge can never be re-offered.
   */
  invoice: { id: string; number: string | null; status: InvoiceStatus } | null;
  /**
   * Every invoice id the charge's rows are stamped with, live OR inactive.
   * `invoice` above is the live one; this is the raw record, so the stamp
   * write at invoice-build time can move a charge off a retired invoice
   * (its predicate admits these ids alongside null) without ever admitting
   * a stamp it did not know about.
   */
  stampedInvoiceIds: string[];
  /** per_item only: the post the charge is for, for the line description. */
  item: { platform: Platform; format: PostFormat; scheduledFor: string } | null;
}

export interface GroupRevisionChargesInput {
  cycles: ChargeCycleRow[];
  items: ChargeItemRow[];
  /** Submitted rounds. Unsubmitted rows are ignored here too, defensively. */
  rounds: ChargeRoundRow[];
  /**
   * Every invoice any round's `invoice_id` points at. A stamp whose invoice
   * is absent from this list reads as unbilled, so the caller must supply
   * the full set — it is a lookup, not a filter.
   */
  invoices: ChargeInvoiceRow[];
}

/**
 * From rows to charges. Pure, so the money grouping is testable without a
 * database; `fetchRevisionCharges` (owner side) gathers the rows and calls
 * this.
 *
 * Groups every submitted round by (cycle, round number), then reads the
 * cycle's CURRENT `billing_mode` to shape the group's charge:
 *
 *   per_round — the group is one charge if it has any flagged row. Amount and
 *               identity come from the earliest-submitted opener; every
 *               opener's id rides along so a race that double-flagged can
 *               never double-bill. State is judged over the WHOLE group.
 *   per_item  — every flagged row in the group is its own charge, judged on
 *               its own status.
 *
 * A mode flipped after rounds were sent can therefore only MERGE charges
 * (per_item -> per_round), never manufacture one: a row's `is_billable` was
 * decided at its commit and is read here as-is.
 *
 * Ordered newest month first, then round number, then the post's date — the
 * order Kelsey would bill in.
 */
export function groupRevisionCharges(
  input: GroupRevisionChargesInput
): RevisionCharge[] {
  const cycleById = new Map(input.cycles.map((cycle) => [cycle.id, cycle]));
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const invoiceById = new Map(
    input.invoices.map((invoice) => [invoice.id, invoice])
  );

  const liveInvoiceFor = (
    invoiceId: string | null
  ): RevisionCharge["invoice"] => {
    if (!invoiceId) return null;
    const invoice = invoiceById.get(invoiceId);
    if (!invoice || invoice.inactive_at !== null) return null;
    return {
      id: invoice.id,
      number: invoice.invoice_number,
      status: invoice.status,
    };
  };

  // (cycleId, roundNumber) -> the group's submitted rounds.
  const groups = new Map<
    string,
    { cycle: ChargeCycleRow; roundNumber: number; rounds: ChargeRoundRow[] }
  >();
  for (const round of input.rounds) {
    // Standing rule 1, applied here as well as at the read: debris is not data.
    if (round.submitted_at === null) continue;
    const item = itemById.get(round.content_item_id);
    if (!item) continue;
    const cycle = cycleById.get(item.cycle_id);
    if (!cycle) continue;

    const key = `${cycle.id}:${round.round_number}`;
    const group = groups.get(key);
    if (group) group.rounds.push(round);
    else groups.set(key, { cycle, roundNumber: round.round_number, rounds: [round] });
  }

  const charges: RevisionCharge[] = [];
  for (const [key, group] of groups) {
    const { cycle, roundNumber, rounds } = group;
    const monthKey = cycle.month.slice(0, 7);
    // A flagged row carries its amount by migration 019's CHECK; the price
    // guard is belt-and-braces against a hand-edited row.
    const flagged = rounds
      .filter((round) => round.is_billable && round.price !== null)
      .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
    if (flagged.length === 0) continue;

    if (cycle.billing_mode === "per_round") {
      const opener = flagged[0];
      charges.push({
        key,
        cycleId: cycle.id,
        clientId: cycle.client_id,
        monthKey,
        roundNumber,
        billingMode: "per_round",
        amount: opener.price as number,
        roundIds: flagged.map((round) => round.id),
        state: evaluateRoundGroup(rounds.map((round) => round.status)),
        invoice:
          flagged.map((round) => liveInvoiceFor(round.invoice_id)).find(Boolean) ??
          null,
        stampedInvoiceIds: Array.from(
          new Set(
            flagged
              .map((round) => round.invoice_id)
              .filter((id): id is string => id !== null)
          )
        ),
        item: null,
      });
      continue;
    }

    for (const round of flagged) {
      const item = itemById.get(round.content_item_id);
      charges.push({
        key: round.id,
        cycleId: cycle.id,
        clientId: cycle.client_id,
        monthKey,
        roundNumber,
        billingMode: "per_item",
        amount: round.price as number,
        roundIds: [round.id],
        state: evaluateRoundGroup([round.status]),
        invoice: liveInvoiceFor(round.invoice_id),
        stampedInvoiceIds: round.invoice_id === null ? [] : [round.invoice_id],
        item: item
          ? {
              platform: item.platform,
              format: item.format,
              scheduledFor: item.scheduled_for,
            }
          : null,
      });
    }
  }

  charges.sort((a, b) => {
    if (a.monthKey !== b.monthKey) return b.monthKey.localeCompare(a.monthKey);
    if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber;
    return (a.item?.scheduledFor ?? "").localeCompare(b.item?.scheduledFor ?? "");
  });
  return charges;
}
