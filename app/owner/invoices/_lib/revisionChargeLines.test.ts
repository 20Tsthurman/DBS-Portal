import { describe, expect, it } from "vitest";
import { describeRevisionCharge, sameRoundIds } from "./revisionChargeLines";

/**
 * Pins the copy deck's "Invoice line items" rows verbatim. These strings land
 * on the client's invoice PDF, so a rewording is a deck violation.
 */
describe("describeRevisionCharge", () => {
  it("per round — the deck row", () => {
    expect(
      describeRevisionCharge({
        billingMode: "per_round",
        roundNumber: 2,
        monthKey: "2026-10",
        item: null,
      })
    ).toBe("Content revisions · Round 2 · October 2026");
  });

  it("per post — the deck row, in the client's vocabulary", () => {
    expect(
      describeRevisionCharge({
        billingMode: "per_item",
        roundNumber: 2,
        monthKey: "2026-10",
        // 15:00 UTC on the 10th is 10:00 Central on the 10th.
        item: {
          platform: "instagram",
          format: "reel",
          scheduledFor: "2026-10-10T15:00:00+00:00",
        },
      })
    ).toBe("Content revisions · Round 2 · Instagram Reel, Oct 10");
  });

  it("per post reads the client's format word — a feed post is a Post", () => {
    expect(
      describeRevisionCharge({
        billingMode: "per_item",
        roundNumber: 3,
        monthKey: "2026-10",
        item: {
          platform: "instagram",
          format: "feed",
          scheduledFor: "2026-10-17T15:00:00+00:00",
        },
      })
    ).toBe("Content revisions · Round 3 · Instagram Post, Oct 17");
  });

  it("dates the post in Central time, not UTC", () => {
    // 03:00 UTC on the 11th is 22:00 Central on the 10th.
    expect(
      describeRevisionCharge({
        billingMode: "per_item",
        roundNumber: 2,
        monthKey: "2026-10",
        item: {
          platform: "facebook",
          format: "feed",
          scheduledFor: "2026-10-11T03:00:00+00:00",
        },
      })
    ).toBe("Content revisions · Round 2 · Facebook Post, Oct 10");
  });

  it("a per-post charge with no post falls back to the per-round shape", () => {
    expect(
      describeRevisionCharge({
        billingMode: "per_item",
        roundNumber: 2,
        monthKey: "2026-10",
        item: null,
      })
    ).toBe("Content revisions · Round 2 · October 2026");
  });
});

describe("sameRoundIds", () => {
  it("is set equality", () => {
    expect(sameRoundIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameRoundIds(["a"], ["a", "b"])).toBe(false);
    expect(sameRoundIds([], [])).toBe(true);
    expect(sameRoundIds(["a"], ["b"])).toBe(false);
  });
});
