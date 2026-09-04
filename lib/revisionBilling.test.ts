import { describe, expect, it } from "vitest";
import {
  computeRoundCharge,
  evaluateRoundGroup,
  formatChargeAmount,
  FREE_ROUND_COLUMNS,
  groupRevisionCharges,
  isRoundPriced,
  roundChargeColumns,
  type ChargeCycleRow,
  type ChargeInvoiceRow,
  type ChargeItemRow,
  type ChargeRoundRow,
  type RoundBillingInput,
} from "./revisionBilling";

/**
 * Pins the money function. Every branch, both modes, the covered case, price
 * 0, price null, and included_rounds above 1 — because a wrong branch here is
 * a charge nobody consented to or a charge never collected, and neither
 * surfaces until an invoice goes out.
 */

const base: RoundBillingInput = {
  roundNumber: 2,
  includedRounds: 1,
  extraRoundPrice: 75,
  billingMode: "per_round",
  roundAlreadyOpenInCycle: false,
};

describe("computeRoundCharge", () => {
  it("round 1 is included under the default settings, in both modes", () => {
    expect(computeRoundCharge({ ...base, roundNumber: 1 })).toEqual({
      kind: "included",
    });
    expect(
      computeRoundCharge({ ...base, roundNumber: 1, billingMode: "per_item" })
    ).toEqual({ kind: "included" });
  });

  it("round 2 opens a per_round charge at the cycle's price when nothing has opened it", () => {
    expect(computeRoundCharge(base)).toEqual({ kind: "charge", price: 75 });
  });

  it("round 2 is covered in per_round when another post already opened it", () => {
    expect(
      computeRoundCharge({ ...base, roundAlreadyOpenInCycle: true })
    ).toEqual({ kind: "covered" });
  });

  it("per_item ignores the opener — every revised post is its own charge", () => {
    expect(
      computeRoundCharge({
        ...base,
        billingMode: "per_item",
        roundAlreadyOpenInCycle: true,
      })
    ).toEqual({ kind: "charge", price: 75 });
    expect(
      computeRoundCharge({ ...base, billingMode: "per_item" })
    ).toEqual({ kind: "charge", price: 75 });
  });

  it("price 0 turns billing off: included in both modes, opener or not", () => {
    for (const billingMode of ["per_round", "per_item"] as const) {
      for (const roundAlreadyOpenInCycle of [false, true]) {
        expect(
          computeRoundCharge({
            ...base,
            extraRoundPrice: 0,
            billingMode,
            roundAlreadyOpenInCycle,
          })
        ).toEqual({ kind: "included" });
      }
    }
  });

  it("price null turns billing off the same way", () => {
    for (const billingMode of ["per_round", "per_item"] as const) {
      expect(
        computeRoundCharge({ ...base, extraRoundPrice: null, billingMode })
      ).toEqual({ kind: "included" });
    }
  });

  it("a negative price is not a price", () => {
    expect(computeRoundCharge({ ...base, extraRoundPrice: -5 })).toEqual({
      kind: "included",
    });
  });

  it("included_rounds above 1 keeps round 2 free and prices round 3", () => {
    expect(
      computeRoundCharge({ ...base, includedRounds: 2, roundNumber: 2 })
    ).toEqual({ kind: "included" });
    expect(
      computeRoundCharge({ ...base, includedRounds: 2, roundNumber: 3 })
    ).toEqual({ kind: "charge", price: 75 });
    // Included rounds are free even for a per_item cycle.
    expect(
      computeRoundCharge({
        ...base,
        includedRounds: 2,
        roundNumber: 2,
        billingMode: "per_item",
      })
    ).toEqual({ kind: "included" });
  });

  it("included_rounds 0 makes round 1 billable", () => {
    expect(
      computeRoundCharge({ ...base, includedRounds: 0, roundNumber: 1 })
    ).toEqual({ kind: "charge", price: 75 });
  });

  it("snapshots the exact price it was given, cents included", () => {
    expect(computeRoundCharge({ ...base, extraRoundPrice: 62.5 })).toEqual({
      kind: "charge",
      price: 62.5,
    });
  });

  it("a later round is still one charge, not a cumulative one", () => {
    // Round 4 on a per_round cycle with one included round: the fourth batch
    // costs the cycle price, not three times it.
    expect(computeRoundCharge({ ...base, roundNumber: 4 })).toEqual({
      kind: "charge",
      price: 75,
    });
  });
});

describe("isRoundPriced", () => {
  it("answers no without the opener when the round is within the included count", () => {
    expect(
      isRoundPriced({ roundNumber: 1, includedRounds: 1, extraRoundPrice: 75 })
    ).toBe(false);
  });

  it("answers no when the cycle has no price, and yes otherwise", () => {
    expect(
      isRoundPriced({ roundNumber: 2, includedRounds: 1, extraRoundPrice: null })
    ).toBe(false);
    expect(
      isRoundPriced({ roundNumber: 2, includedRounds: 1, extraRoundPrice: 0 })
    ).toBe(false);
    expect(
      isRoundPriced({ roundNumber: 2, includedRounds: 1, extraRoundPrice: 75 })
    ).toBe(true);
  });
});

describe("roundChargeColumns", () => {
  it("writes the flag and the amount together on a charge", () => {
    expect(roundChargeColumns({ kind: "charge", price: 75 })).toEqual({
      is_billable: true,
      price: 75,
    });
  });

  it("writes false/null — no marker — for included and covered alike", () => {
    expect(roundChargeColumns({ kind: "included" })).toEqual(FREE_ROUND_COLUMNS);
    expect(roundChargeColumns({ kind: "covered" })).toEqual(FREE_ROUND_COLUMNS);
    expect(FREE_ROUND_COLUMNS).toEqual({ is_billable: false, price: null });
  });

  it("never pairs a price with a false flag, in any state", () => {
    for (const billing of [
      { kind: "included" as const },
      { kind: "covered" as const },
      { kind: "charge" as const, price: 75 },
    ]) {
      const columns = roundChargeColumns(billing);
      if (columns.is_billable) {
        expect(columns.price).toBeGreaterThan(0);
      } else {
        expect(columns.price).toBeNull();
      }
    }
  });
});

describe("formatChargeAmount", () => {
  it("drops the cents on a whole amount — the deck's $75", () => {
    expect(formatChargeAmount(75)).toBe("$75");
    expect(formatChargeAmount(1250)).toBe("$1,250");
  });

  it("shows cents only when there are cents", () => {
    expect(formatChargeAmount(62.5)).toBe("$62.50");
    expect(formatChargeAmount(0.5)).toBe("$0.50");
    expect(formatChargeAmount(99.99)).toBe("$99.99");
  });

  it("never prints $75.00", () => {
    expect(formatChargeAmount(75.0)).toBe("$75");
    expect(formatChargeAmount(74.999)).toBe("$75");
  });
});

// ---------------------------------------------------------------------------
// The read side
// ---------------------------------------------------------------------------

describe("evaluateRoundGroup", () => {
  it("waives a group in which every round was denied", () => {
    expect(evaluateRoundGroup(["denied"])).toBe("waived");
    expect(evaluateRoundGroup(["denied", "denied", "denied"])).toBe("waived");
  });

  it("holds a group pending while any round is still open", () => {
    expect(evaluateRoundGroup(["open"])).toBe("pending");
    expect(evaluateRoundGroup(["addressed", "open"])).toBe("pending");
    expect(evaluateRoundGroup(["denied", "open"])).toBe("pending");
  });

  it("is ready once everything is answered and not everything was denied", () => {
    expect(evaluateRoundGroup(["addressed"])).toBe("ready");
    expect(evaluateRoundGroup(["addressed", "addressed"])).toBe("ready");
    // The money case: the opener denied, the rest accepted. The batch was
    // revised, so the round bills.
    expect(evaluateRoundGroup(["denied", "addressed", "addressed"])).toBe(
      "ready"
    );
  });

  it("answers waived for an empty group — the no-bill default", () => {
    expect(evaluateRoundGroup([])).toBe("waived");
  });
});

describe("groupRevisionCharges", () => {
  const CYCLE = "cycle-oct";
  const CLIENT = "client-1";

  const cycle = (
    billing_mode: ChargeCycleRow["billing_mode"],
    overrides: Partial<ChargeCycleRow> = {}
  ): ChargeCycleRow => ({
    id: CYCLE,
    client_id: CLIENT,
    month: "2026-10-01",
    billing_mode,
    ...overrides,
  });

  const item = (id: string, overrides: Partial<ChargeItemRow> = {}): ChargeItemRow => ({
    id,
    cycle_id: CYCLE,
    platform: "instagram",
    format: "reel",
    scheduled_for: `2026-10-${id.slice(-2)}T15:00:00+00:00`,
    ...overrides,
  });

  const round = (
    id: string,
    itemId: string,
    overrides: Partial<ChargeRoundRow> = {}
  ): ChargeRoundRow => ({
    id,
    content_item_id: itemId,
    round_number: 2,
    is_billable: false,
    price: null,
    status: "open",
    submitted_at: "2026-09-20T10:00:00+00:00",
    invoice_id: null,
    ...overrides,
  });

  const items = [item("item-10"), item("item-11"), item("item-12")];

  it("per_round: three posts in one round are one charge, keyed on the opener", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-a", "item-10", {
          is_billable: true,
          price: 75,
          submitted_at: "2026-09-20T10:00:00+00:00",
        }),
        round("r-b", "item-11", { submitted_at: "2026-09-20T11:00:00+00:00" }),
        round("r-c", "item-12", { submitted_at: "2026-09-21T09:00:00+00:00" }),
      ],
      invoices: [],
    });

    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      key: `${CYCLE}:2`,
      cycleId: CYCLE,
      clientId: CLIENT,
      monthKey: "2026-10",
      roundNumber: 2,
      billingMode: "per_round",
      amount: 75,
      roundIds: ["r-a"],
      state: "pending",
      invoice: null,
      item: null,
    });
  });

  it("per_round: the opener denied but the rest accepted still bills", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-a", "item-10", { is_billable: true, price: 75, status: "denied" }),
        round("r-b", "item-11", { status: "addressed" }),
        round("r-c", "item-12", { status: "addressed" }),
      ],
      invoices: [],
    });
    expect(charges[0].state).toBe("ready");
    expect(charges[0].amount).toBe(75);
  });

  it("per_round: a round in which every post was denied is waived", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-a", "item-10", { is_billable: true, price: 75, status: "denied" }),
        round("r-b", "item-11", { status: "denied" }),
      ],
      invoices: [],
    });
    expect(charges[0].state).toBe("waived");
  });

  it("per_round: one open post holds the whole round pending", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-a", "item-10", { is_billable: true, price: 75, status: "addressed" }),
        round("r-b", "item-11", { status: "open" }),
      ],
      invoices: [],
    });
    expect(charges[0].state).toBe("pending");
  });

  it("per_round: two openers from a same-instant race bill once, at the earliest amount, carrying both ids", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-late", "item-11", {
          is_billable: true,
          price: 90,
          submitted_at: "2026-09-20T10:00:00.500+00:00",
        }),
        round("r-early", "item-10", {
          is_billable: true,
          price: 75,
          submitted_at: "2026-09-20T10:00:00.100+00:00",
        }),
      ],
      invoices: [],
    });
    expect(charges).toHaveLength(1);
    expect(charges[0].amount).toBe(75);
    expect(charges[0].roundIds).toEqual(["r-early", "r-late"]);
  });

  it("per_item: every flagged post is its own charge, judged on its own status", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_item")],
      items,
      rounds: [
        round("r-a", "item-10", { is_billable: true, price: 20, status: "addressed" }),
        round("r-b", "item-11", { is_billable: true, price: 20, status: "denied" }),
        round("r-c", "item-12", { is_billable: true, price: 20, status: "open" }),
      ],
      invoices: [],
    });
    expect(charges.map((c) => [c.key, c.state, c.amount])).toEqual([
      ["r-a", "ready", 20],
      ["r-b", "waived", 20],
      ["r-c", "pending", 20],
    ]);
    expect(charges[0].item).toEqual({
      platform: "instagram",
      format: "reel",
      scheduledFor: "2026-10-10T15:00:00+00:00",
    });
    expect(charges[0].roundIds).toEqual(["r-a"]);
  });

  it("produces no charge from free rounds, and ignores an unsubmitted flagged row", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-1", "item-10", { round_number: 1, status: "addressed" }),
        round("r-2", "item-11", { round_number: 1, status: "denied" }),
        // Debris that somehow carries a flag: standing rule 1 says it is not data.
        round("r-debris", "item-12", {
          is_billable: true,
          price: 75,
          submitted_at: null,
        }),
      ],
      invoices: [],
    });
    expect(charges).toEqual([]);
  });

  it("reads a stamp to a live invoice as billed, and to an inactive one as unbilled", () => {
    const invoices: ChargeInvoiceRow[] = [
      { id: "inv-live", invoice_number: "INV-2026-0012", status: "sent", inactive_at: null },
      {
        id: "inv-retired",
        invoice_number: "INV-2026-0009",
        status: "sent",
        inactive_at: "2026-09-30T00:00:00+00:00",
      },
    ];
    const charges = groupRevisionCharges({
      cycles: [cycle("per_item")],
      items,
      rounds: [
        round("r-a", "item-10", {
          is_billable: true,
          price: 20,
          status: "addressed",
          invoice_id: "inv-live",
        }),
        round("r-b", "item-11", {
          is_billable: true,
          price: 20,
          status: "addressed",
          invoice_id: "inv-retired",
        }),
        round("r-c", "item-12", {
          is_billable: true,
          price: 20,
          status: "addressed",
          invoice_id: "inv-not-fetched",
        }),
      ],
      invoices,
    });
    expect(charges.map((c) => c.invoice)).toEqual([
      { id: "inv-live", number: "INV-2026-0012", status: "sent" },
      null,
      null,
    ]);
    // The raw stamps survive alongside, so a re-stamp can move a charge off
    // the retired invoice without admitting a stamp it does not know about.
    expect(charges.map((c) => c.stampedInvoiceIds)).toEqual([
      ["inv-live"],
      ["inv-retired"],
      ["inv-not-fetched"],
    ]);
  });

  it("per_round: collects every opener's stamp, deduplicated, with none for unstamped", () => {
    const stamped = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-a", "item-10", { is_billable: true, price: 75, invoice_id: "inv-1" }),
        round("r-b", "item-11", { is_billable: true, price: 75, invoice_id: "inv-1" }),
      ],
      invoices: [],
    });
    expect(stamped[0].stampedInvoiceIds).toEqual(["inv-1"]);

    const unstamped = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [round("r-a", "item-10", { is_billable: true, price: 75 })],
      invoices: [],
    });
    expect(unstamped[0].stampedInvoiceIds).toEqual([]);
  });

  it("keeps cycles and round numbers apart, newest month first", () => {
    const novCycle = cycle("per_round", { id: "cycle-nov", month: "2026-11-01" });
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round"), novCycle],
      items: [...items, item("item-nov", { cycle_id: "cycle-nov" })],
      rounds: [
        round("r-oct-3", "item-10", { round_number: 3, is_billable: true, price: 75 }),
        round("r-oct-2", "item-11", { round_number: 2, is_billable: true, price: 75 }),
        round("r-nov-2", "item-nov", { round_number: 2, is_billable: true, price: 80 }),
      ],
      invoices: [],
    });
    expect(charges.map((c) => [c.monthKey, c.roundNumber, c.amount])).toEqual([
      ["2026-11", 2, 80],
      ["2026-10", 2, 75],
      ["2026-10", 3, 75],
    ]);
  });

  it("a mode flipped to per_round after two per_item openers merges them into one charge", () => {
    const charges = groupRevisionCharges({
      cycles: [cycle("per_round")],
      items,
      rounds: [
        round("r-a", "item-10", { is_billable: true, price: 20, status: "addressed" }),
        round("r-b", "item-11", { is_billable: true, price: 20, status: "addressed" }),
      ],
      invoices: [],
    });
    expect(charges).toHaveLength(1);
    expect(charges[0].roundIds).toEqual(["r-a", "r-b"]);
  });
});
