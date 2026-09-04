import { describe, expect, it } from "vitest";
import { shortMonthDayLabelForDateKey, wasAutoApproved } from "./format";

/**
 * The deck's "Sept 25" is a fourth date shape with its own month table
 * (decided 2026-09-04), and the only thing that distinguishes an
 * auto-approved post from a client-approved one is a free-text column. Both
 * are cheap to break silently, so both are pinned.
 */

describe("shortMonthDayLabelForDateKey", () => {
  it("is the deck's Sept, not timezone.ts's Sep", () => {
    expect(shortMonthDayLabelForDateKey("2026-09-25")).toBe("Sept 25");
  });

  it("spells out the short months and cuts the long ones", () => {
    expect(shortMonthDayLabelForDateKey("2026-01-01")).toBe("Jan 1");
    expect(shortMonthDayLabelForDateKey("2026-03-03")).toBe("March 3");
    expect(shortMonthDayLabelForDateKey("2026-06-30")).toBe("June 30");
    expect(shortMonthDayLabelForDateKey("2026-12-24")).toBe("Dec 24");
  });
});

describe("wasAutoApproved", () => {
  it("is the lock's literal on an approved post, and nothing else", () => {
    expect(wasAutoApproved({ status: "approved", approved_by: "auto" })).toBe(
      true
    );
    expect(
      wasAutoApproved({ status: "published", approved_by: "auto" })
    ).toBe(true);
    expect(wasAutoApproved({ status: "approved", approved_by: null })).toBe(
      false
    );
    expect(
      wasAutoApproved({ status: "approved", approved_by: "client" })
    ).toBe(false);
    expect(wasAutoApproved({ status: "in_review", approved_by: "auto" })).toBe(
      false
    );
  });
});
