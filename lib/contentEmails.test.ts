import { describe, expect, it } from "vitest";
import { escapeHtml } from "./escapeHtml";
import {
  DEADLINE_AUTO_APPROVE_SENTENCE,
  buildContentReleaseEmailHtml,
  buildContentReleaseEmailSubject,
  buildContentRereleaseEmailHtml,
  buildContentRereleaseEmailSubject,
} from "./contentEmails";

/**
 * The two cycle emails are copy-deck surfaces (Screens 8 and 10). These tests
 * pin the strings a client reads, and the one structural promise the deck
 * makes about them: the auto-approve sentence is the same sentence
 * everywhere, and the re-release email says nothing about a charge before
 * Phase 8 exists.
 */

const DEADLINE = "Friday, September 25";
const REVIEW_URL = "https://portal.example.test/client/review";

function release(postCount = 12): string {
  return buildContentReleaseEmailHtml({
    recipientName: "Renee Alvarez",
    monthName: "October",
    postCount,
    deadlineLabel: DEADLINE,
    reviewUrl: REVIEW_URL,
  });
}

function rerelease(updatedCount = 3): string {
  return buildContentRereleaseEmailHtml({
    recipientName: "Renee Alvarez",
    monthName: "October",
    updatedCount,
    deadlineLabel: DEADLINE,
    reviewUrl: REVIEW_URL,
  });
}

/** The whole "Reviews are open through ..." paragraph, as rendered. */
function deadlineParagraph(html: string): string {
  const match = html.match(/<p[^>]*>Reviews are open through [^<]*<\/p>/);
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

describe("the auto-approve sentence", () => {
  it("is the queue's deadline-card line 2, verbatim (copy deck Screen 1)", () => {
    expect(DEADLINE_AUTO_APPROVE_SENTENCE).toBe(
      "Anything you haven't reviewed by then is approved automatically, so your month stays on schedule."
    );
  });

  it("appears in both emails exactly once, HTML-escaped", () => {
    const escaped = escapeHtml(DEADLINE_AUTO_APPROVE_SENTENCE);
    expect(escaped).not.toBe(DEADLINE_AUTO_APPROVE_SENTENCE); // the apostrophe
    for (const html of [release(), rerelease()]) {
      expect(html.split(escaped)).toHaveLength(2);
      expect(html).not.toContain(DEADLINE_AUTO_APPROVE_SENTENCE);
    }
  });

  it("renders body line 2 byte-identically in the release and re-release emails", () => {
    const releaseLine = deadlineParagraph(release());
    expect(releaseLine).toContain(`Reviews are open through ${DEADLINE}. `);
    expect(deadlineParagraph(rerelease())).toBe(releaseLine);
  });
});

describe("release email (copy deck Screen 8)", () => {
  it("subject", () => {
    expect(buildContentReleaseEmailSubject("October")).toBe(
      "Your October posts are ready to review"
    );
  });

  it("heading, first-name greeting, CTA label and link", () => {
    const html = release();
    expect(html).toContain("Your October content is ready");
    expect(html).toContain("Hi Renee,");
    expect(html).toContain(">Review your posts</a>");
    expect(html).toContain(`href="${REVIEW_URL}"`);
  });

  it("body line 1 and preheader — twelve posts", () => {
    const html = release(12);
    expect(html).toContain(
      "Kelsey has 12 posts ready for your review — take a look when you have a few minutes, and approve each one or ask for changes."
    );
    expect(html).toContain("12 posts · reviews open through Friday, September 25");
  });

  it("body line 1 and preheader — one post", () => {
    const html = release(1);
    expect(html).toContain(
      "Kelsey has 1 post ready for your review — take a look when you have a minute, and approve it or ask for changes."
    );
    expect(html).toContain("1 post · reviews open through Friday, September 25");
  });
});

describe("re-release email (copy deck Screen 10)", () => {
  it("subject — plural and one post", () => {
    expect(buildContentRereleaseEmailSubject("October", 3)).toBe(
      "Your October updates are ready to review"
    );
    expect(buildContentRereleaseEmailSubject("October", 1)).toBe(
      "Your October update is ready to review"
    );
  });

  it("heading — plural and one post", () => {
    expect(rerelease(3)).toContain("Kelsey updated your October posts");
    expect(rerelease(1)).toContain("Kelsey updated one of your October posts");
  });

  it("body line 1 — three posts", () => {
    expect(rerelease(3)).toContain(
      "Kelsey made the changes you asked for on 3 posts — have a look at the new versions when you have a few minutes, and approve each one or ask for more changes."
    );
  });

  it("body line 1 — one post", () => {
    expect(rerelease(1)).toContain(
      "Kelsey made the changes you asked for on 1 post — have a look at the new version when you have a minute, and approve it or ask for more changes."
    );
  });

  it("preheader — plural and one post", () => {
    expect(rerelease(3)).toContain(
      "3 updated posts · reviews open through Friday, September 25"
    );
    expect(rerelease(1)).toContain(
      "1 updated post · reviews open through Friday, September 25"
    );
  });

  it("first-name greeting, CTA label and link", () => {
    const html = rerelease();
    expect(html).toContain("Hi Renee,");
    expect(html).toContain(">Review the updates</a>");
    expect(html).toContain(`href="${REVIEW_URL}"`);
  });

  it("carries no charge language — held until Phase 8", () => {
    const html = rerelease();
    // Whole words: the shell's `background-color` contains "round".
    expect(html).not.toMatch(/\b(charge|charged|invoice|round)\b|\$/i);
  });

  it("escapes every interpolated value", () => {
    const html = buildContentRereleaseEmailHtml({
      recipientName: "<Renee> Alvarez",
      monthName: "Oct & Nov",
      updatedCount: 2,
      deadlineLabel: "Fri <25>",
      reviewUrl: REVIEW_URL,
    });
    expect(html).not.toContain("<Renee>");
    expect(html).toContain("Hi &lt;Renee&gt;,");
    expect(html).not.toContain("Oct & Nov");
    expect(html).toContain("Oct &amp; Nov");
    expect(html).not.toContain("Fri <25>");
    expect(html).toContain("Reviews are open through Fri &lt;25&gt;.");
  });
});
