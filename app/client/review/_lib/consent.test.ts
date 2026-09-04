import { describe, expect, it } from "vitest";
import {
  consentFor,
  consentMatches,
  isValidConsent,
  TERMS_CHANGED_ERROR,
} from "./consent";

/**
 * Pins the refuse rule. The commit writes a charge only when the consent is a
 * charge of exactly that amount; a free outcome is always accepted. A wrong
 * branch here is a charge the client never saw.
 */
describe("consentMatches", () => {
  it("accepts a free outcome under any consent", () => {
    expect(consentMatches({ kind: "none" }, { kind: "included" })).toBe(true);
    expect(consentMatches({ kind: "none" }, { kind: "covered" })).toBe(true);
    expect(
      consentMatches({ kind: "charge", amount: 75 }, { kind: "included" })
    ).toBe(true);
    expect(
      consentMatches({ kind: "charge", amount: 75 }, { kind: "covered" })
    ).toBe(true);
  });

  it("accepts a charge only at exactly the consented amount", () => {
    expect(
      consentMatches({ kind: "charge", amount: 75 }, { kind: "charge", price: 75 })
    ).toBe(true);
    expect(
      consentMatches(
        { kind: "charge", amount: 62.5 },
        { kind: "charge", price: 62.5 }
      )
    ).toBe(true);
  });

  it("refuses a charge the client was never shown", () => {
    expect(
      consentMatches({ kind: "none" }, { kind: "charge", price: 75 })
    ).toBe(false);
  });

  it("refuses a charge that differs from the consented amount in either direction", () => {
    expect(
      consentMatches({ kind: "charge", amount: 75 }, { kind: "charge", price: 90 })
    ).toBe(false);
    expect(
      consentMatches({ kind: "charge", amount: 75 }, { kind: "charge", price: 60 })
    ).toBe(false);
  });
});

describe("consentFor", () => {
  it("carries the amount for a charge and nothing otherwise", () => {
    expect(consentFor({ kind: "charge", price: 75 })).toEqual({
      kind: "charge",
      amount: 75,
    });
    expect(consentFor({ kind: "included" })).toEqual({ kind: "none" });
    expect(consentFor({ kind: "covered" })).toEqual({ kind: "none" });
  });

  it("round-trips through the rule for every state", () => {
    for (const billing of [
      { kind: "included" as const },
      { kind: "covered" as const },
      { kind: "charge" as const, price: 75 },
    ]) {
      expect(consentMatches(consentFor(billing), billing)).toBe(true);
    }
  });
});

describe("isValidConsent", () => {
  it("accepts the two shapes", () => {
    expect(isValidConsent({ kind: "none" })).toBe(true);
    expect(isValidConsent({ kind: "charge", amount: 75 })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidConsent(null)).toBe(false);
    expect(isValidConsent(undefined)).toBe(false);
    expect(isValidConsent({})).toBe(false);
    expect(isValidConsent({ kind: "charge" })).toBe(false);
    expect(isValidConsent({ kind: "charge", amount: 0 })).toBe(false);
    expect(isValidConsent({ kind: "charge", amount: -5 })).toBe(false);
    expect(isValidConsent({ kind: "charge", amount: "75" })).toBe(false);
    expect(isValidConsent({ kind: "charge", amount: Number.NaN })).toBe(false);
    expect(isValidConsent({ kind: "maybe" })).toBe(false);
  });
});

describe("TERMS_CHANGED_ERROR", () => {
  it("is a stable sentinel, not prose", () => {
    expect(TERMS_CHANGED_ERROR).toBe("terms_changed");
  });
});
