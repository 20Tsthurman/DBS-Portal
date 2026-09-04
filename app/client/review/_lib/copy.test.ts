import { describe, expect, it } from "vitest";
import {
  autoApprovedMeta,
  autoBody,
  closedEarlyTitle,
  consentAmountRow,
  consentConfirmLabel,
  consentDialogTitle,
  consentSubLine,
  coveredSubLine,
  deadlineBody,
  deadlineTitle,
  FOOTER_HELPER_INCLUDED,
  FOOTER_HELPER_ROUND_1,
  footerHelperCharge,
  footerHelperCovered,
  SEND_DIALOG_LINE_3,
  SEND_DIALOG_LINE_3_INCLUDED,
  SEND_FAILED_TERMS_CHANGED,
  UPDATED_SMALL_PRINT_CHARGE,
  UPDATED_SMALL_PRINT_COVERED,
} from "./copy";

/**
 * Pins the Phase 7 copy-deck rows the client reads on a closed month. The
 * deadline body is the one place the deck asked for a FUNCTION rather than
 * strings ("one sentence shape with two counts as inputs", 2026-09-02), so
 * every deck row for it is asserted verbatim here — a rewording that reads
 * fine to a developer is still a deck violation.
 */

const ENDED = "Friday, September 25";

describe("deadlineBody", () => {
  it("canvas row: approved and auto, plural", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 9, autoCount: 3 })
    ).toBe(
      "Reviews ended Friday, September 25. You approved 9 posts, and 3 you hadn't reviewed were approved automatically, the way your content plan works. Everything goes out on schedule."
    );
  });

  it("deck row: one approved + one auto", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 1, autoCount: 1 })
    ).toBe(
      "Reviews ended Friday, September 25. You approved 1 post, and 1 you hadn't reviewed was approved automatically, the way your content plan works. Everything goes out on schedule."
    );
  });

  it("mixed inflects each count on its own", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 1, autoCount: 4 })
    ).toContain("You approved 1 post, and 4 you hadn't reviewed were");
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 6, autoCount: 1 })
    ).toContain("You approved 6 posts, and 1 you hadn't reviewed was");
  });

  it("deck row: none auto", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 12, autoCount: 0 })
    ).toBe(
      "Reviews ended Friday, September 25. You approved all 12 posts, and everything goes out on schedule."
    );
  });

  it("deck row: none approved", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 0, autoCount: 12 })
    ).toBe(
      "Reviews ended Friday, September 25. The 12 posts you hadn't reviewed were approved automatically, the way your content plan works. Everything goes out on schedule."
    );
  });

  it("deck row: none approved, one post", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 0, autoCount: 1 })
    ).toBe(
      "Reviews ended Friday, September 25. The post you hadn't reviewed was approved automatically, the way your content plan works. It goes out as planned."
    );
  });

  it("never prints 'all 1 posts' — the flagged singular", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 1, autoCount: 0 })
    ).toBe(
      "Reviews ended Friday, September 25. You approved your post, and it goes out as planned."
    );
  });

  it("nothing counted — every post with Kelsey or kept as planned", () => {
    expect(
      deadlineBody({ endedLabel: ENDED, approvedCount: 0, autoCount: 0 })
    ).toBe("Reviews ended Friday, September 25. Everything goes out on schedule.");
  });
});

describe("the other closed-month rows", () => {
  it("titles name the month", () => {
    expect(deadlineTitle("October")).toBe("Your October content is set");
    expect(closedEarlyTitle("October")).toBe("Reviews are closed for October");
  });

  it("Screen 5 auto body", () => {
    expect(autoBody("October", ENDED, "October 27")).toBe(
      "Reviews for October ended on Friday, September 25, and this post hadn't been reviewed — so it was approved automatically, the way your content plan works. It goes out October 27 as planned."
    );
  });

  it("row meta", () => {
    expect(autoApprovedMeta("Sept 25")).toBe("Approved automatically · Sept 25");
  });
});

/**
 * Phase 8's rows — the consent copy and its three siblings, every one
 * asserted verbatim. These are the strings a client reads before agreeing to
 * be billed, so a rewording here is a consent problem, not a style one.
 */
describe("Screen 3 footer, by billing state", () => {
  it("round 1", () => {
    expect(FOOTER_HELPER_ROUND_1).toBe(
      "One round of changes is included with your month."
    );
  });

  it("round 2+, included (deck row 2026-09-04)", () => {
    expect(FOOTER_HELPER_INCLUDED).toBe("This round of changes is included.");
  });

  it("round 2+, per-round covered (deck row 2026-09-04)", () => {
    expect(footerHelperCovered(2)).toBe(
      "Already covered by round 2 — no additional charge for this post."
    );
    expect(footerHelperCovered(3)).toContain("round 3");
  });

  it("round 2+, a charge (Screen 9's form footer)", () => {
    expect(footerHelperCharge(2, "$75")).toBe(
      "This is round 2 — $75, added to your next invoice."
    );
  });
});

describe("Screen 4 line 3, by billing state", () => {
  it("round 1", () => {
    expect(SEND_DIALOG_LINE_3).toBe(
      "This is part of your included round of changes."
    );
  });

  it("round 2+, included (deck row 2026-09-04)", () => {
    expect(SEND_DIALOG_LINE_3_INCLUDED).toBe(
      "This round is included — there's no charge for it."
    );
  });
});

describe("Screen 9 consent", () => {
  it("title names the round", () => {
    expect(consentDialogTitle(2)).toBe("Send round 2 to Kelsey?");
  });

  it("amount row", () => {
    expect(consentAmountRow(2, "$75")).toBe("Round 2 of changes — $75");
  });

  it("sub-line at one included round — the canvas row", () => {
    expect(consentSubLine(1)).toBe(
      "Added to your next invoice — nothing is charged today. Your first round was included with your month."
    );
  });

  it("sub-line at two or more included rounds (deck row 2026-09-04)", () => {
    expect(consentSubLine(2)).toBe(
      "Added to your next invoice — nothing is charged today. Your first 2 rounds were included with your month."
    );
    expect(consentSubLine(3)).toContain("Your first 3 rounds were");
  });

  it("sub-line at zero included rounds keeps only the first sentence (deck known gap)", () => {
    expect(consentSubLine(0)).toBe(
      "Added to your next invoice — nothing is charged today."
    );
  });

  it("confirm repeats the price", () => {
    expect(consentConfirmLabel("$75")).toBe("Send · $75");
  });

  it("per-round covered sub-line (deck row 2026-09-04)", () => {
    expect(coveredSubLine(2)).toBe(
      "Round 2 is already on your next invoice — there's no additional charge for this post."
    );
  });
});

describe("Screen 5 Updated small print", () => {
  it("the held row, as written", () => {
    expect(UPDATED_SMALL_PRINT_CHARGE).toBe(
      "Your included round has been used. Another round of changes has a charge — you'll always see the amount before anything is sent."
    );
  });

  it("per-round covered (deck row 2026-09-04)", () => {
    expect(UPDATED_SMALL_PRINT_COVERED).toBe(
      "Your included round has been used. This round of changes is already on your next invoice."
    );
  });
});

describe("Errors", () => {
  it("send failed, terms changed (deck row 2026-09-04)", () => {
    expect(SEND_FAILED_TERMS_CHANGED).toBe(
      "Kelsey updated this month's revision terms while you were writing. Refresh the page and you'll see the current terms before you send."
    );
  });
});
