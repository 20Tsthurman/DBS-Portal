import {
  getSupabaseServiceClient,
  type ContentCycleRecord,
  type ContentItemRecord,
  type InvoiceRecord,
  type RevisionRoundRecord,
} from "@/lib/supabase";
import {
  groupRevisionCharges,
  type ChargeInvoiceRow,
  type ChargeRoundRow,
  type RevisionCharge,
} from "@/lib/revisionBilling";

/**
 * SERVER ONLY — reads with the service-role client. One client's accrued
 * revision charges (spec §6.2), in every state: pending, ready, waived,
 * billed. THE ONE READ behind every owner surface that shows a charge — the
 * cycle bar's revision-charges line and the invoice panel's picker both call
 * this, so the two cannot disagree about what is owed (decided 2026-09-04).
 * Consumers filter; this returns everything so a waived or billed charge can
 * still be shown as such.
 *
 * Owner-side: no client scoping beyond the `client_id` the caller asks for.
 * Every caller is behind `requireOwner`, and every cycle is Kelsey's by
 * definition.
 *
 * WHAT IS READ, and why each filter is there:
 *
 *   cycles   — every cycle for the client, whatever its status. Charges
 *              survive a lock; October's round 2 is still owed in November.
 *   items    — every item in those cycles, for the cycle link and, in
 *              per_item, the post behind the line description.
 *   rounds   — STANDING RULE 1: `submitted_at IS NOT NULL`, always. A debris
 *              row is not data, and the grouper filters again anyway.
 *   invoices — every invoice any round points at, so the grouper can apply
 *              the inactive-invoice rule (a stamp to a retired invoice does
 *              not count as billed). It is a lookup, not a filter, so it is
 *              fetched by id rather than by client.
 *
 * Four round trips, all on indexed columns, over a handful of rows per
 * client. The grouping itself is pure (`groupRevisionCharges`) and tested
 * without a database; nothing here decides money.
 */
export async function fetchRevisionCharges(
  clientId: string
): Promise<RevisionCharge[]> {
  if (!clientId) return [];
  const supabase = getSupabaseServiceClient();

  const { data: cycleData, error: cycleError } = await supabase
    .from("content_cycles")
    .select("id, client_id, month, billing_mode")
    .eq("client_id", clientId);
  if (cycleError) throw new Error(cycleError.message);
  const cycles = (cycleData ?? []) as Array<
    Pick<ContentCycleRecord, "id" | "client_id" | "month" | "billing_mode">
  >;
  if (cycles.length === 0) return [];

  const { data: itemData, error: itemError } = await supabase
    .from("content_items")
    .select("id, cycle_id, platform, format, scheduled_for")
    .in(
      "cycle_id",
      cycles.map((cycle) => cycle.id)
    );
  if (itemError) throw new Error(itemError.message);
  const items = (itemData ?? []) as Array<
    Pick<
      ContentItemRecord,
      "id" | "cycle_id" | "platform" | "format" | "scheduled_for"
    >
  >;
  if (items.length === 0) return [];

  const { data: roundData, error: roundError } = await supabase
    .from("revision_rounds")
    .select(
      "id, content_item_id, round_number, is_billable, price, status, submitted_at, invoice_id"
    )
    .in(
      "content_item_id",
      items.map((item) => item.id)
    )
    .not("submitted_at", "is", null);
  if (roundError) throw new Error(roundError.message);
  const rounds: ChargeRoundRow[] = (
    (roundData ?? []) as Array<
      Pick<
        RevisionRoundRecord,
        | "id"
        | "content_item_id"
        | "round_number"
        | "is_billable"
        | "price"
        | "status"
        | "submitted_at"
        | "invoice_id"
      >
    >
  ).map((round) => ({
    ...round,
    // numeric comes back from PostgREST as it comes; coerce at the boundary
    // the way fetchCyclesForMonth does.
    price: round.price === null ? null : Number(round.price),
  }));
  if (rounds.length === 0) return [];

  const invoiceIds = Array.from(
    new Set(
      rounds
        .map((round) => round.invoice_id)
        .filter((id): id is string => id !== null)
    )
  );
  let invoices: ChargeInvoiceRow[] = [];
  if (invoiceIds.length > 0) {
    const { data: invoiceData, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, invoice_number, status, inactive_at")
      .in("id", invoiceIds);
    if (invoiceError) throw new Error(invoiceError.message);
    invoices = (invoiceData ?? []) as Array<
      Pick<InvoiceRecord, "id" | "invoice_number" | "status" | "inactive_at">
    >;
  }

  return groupRevisionCharges({ cycles, items, rounds, invoices });
}
