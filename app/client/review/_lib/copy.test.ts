import { describe, expect, it } from "vitest";
import {
  autoApprovedMeta,
  autoBody,
  closedEarlyTitle,
  deadlineBody,
  deadlineTitle,
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
