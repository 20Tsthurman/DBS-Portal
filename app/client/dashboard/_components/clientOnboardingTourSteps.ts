import type { DriveStep } from "driver.js";

/**
 * Client onboarding tour (Tour 1) — anchors, copy and step sets.
 *
 * Split out of the component so the copy is reviewable in one place and the
 * component is nothing but driver.js wiring.
 */

// ----------------------------------------------------------------------------
// Anchors
//
// Every selector below matches exactly one element on the client dashboard.
// Three of them are `data-tour` attributes that only exist because the client
// layout opts in: `Sidebar` and `TopBar` are SHARED with Kelsey's layout and
// hardcode nothing, so these attributes are absent from the owner DOM entirely.
// ----------------------------------------------------------------------------
const ANCHORS = {
  /** PhaseTracker's outermost div. The only anchor that predates this feature. */
  phaseTracker: '[data-tour="phase-tracker"]',
  /** The dashboard's Next Shoot <section> — heading and card together, so the
   *  step reads the same whether or not a shoot is scheduled. */
  nextShoot: '[data-tour="next-shoot"]',
  navReview: '[data-tour="nav-review"]',
  navFiles: '[data-tour="nav-files"]',
  navMessages: '[data-tour="nav-messages"]',
  /** TopBar's hamburger. Rendered `lg:hidden`, so it is only ever a mobile
   *  anchor — the desktop step set must never point at it. */
  mobileMenu: '[data-tour="mobile-menu"]',
} as const;

/**
 * Below Tailwind's `lg` breakpoint the sidebar is translated off-screen with
 * `-translate-x-full` but STAYS IN THE DOM, so `getBoundingClientRect` returns
 * a real rect at a negative x and driver.js would happily spotlight a hole in
 * the left margin where nothing is visible. That is the entire reason there
 * are two step sets. 1024px is Tailwind's default `lg`; `tailwind.config.ts`
 * does not override `screens`.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

// ----------------------------------------------------------------------------
// Copy — every string the tour can render, in one place.
// ----------------------------------------------------------------------------
export const CLIENT_ONBOARDING_TOUR_COPY = {
  buttons: {
    next: "Next",
    back: "Back",
    done: "Done",
    skip: "Skip tour",
  },
  phaseTracker: {
    title: "Where things stand",
    body: "Your project moves through four stages. This updates as we go — nothing for you to do here.",
  },
  nextShoot: {
    title: "Your next session",
    body: "Upcoming shoot dates show up here once they're confirmed.",
  },
  review: {
    title: "Your content, before it posts",
    body: "When a batch is ready, you'll review it here — approve what you love, ask for changes on what you don't.",
  },
  files: {
    title: "Everything, downloadable",
    body: "Approved photos and videos live here for good. Download anytime.",
  },
  messages: {
    title: "Reach Kelsey here",
    body: "Questions about a shoot or a post — send them here so nothing gets lost.",
  },
  mobileMenu: {
    title: "Everything else",
    body: "Your content, files, invoices, and messages all live behind this menu.",
  },
} as const;

// The two dashboard steps are identical in both sets; only what follows them
// differs, so they are built once here.
function dashboardSteps(): DriveStep[] {
  return [
    {
      element: ANCHORS.phaseTracker,
      popover: {
        title: CLIENT_ONBOARDING_TOUR_COPY.phaseTracker.title,
        description: CLIENT_ONBOARDING_TOUR_COPY.phaseTracker.body,
        side: "bottom",
        align: "start",
      },
    },
    {
      element: ANCHORS.nextShoot,
      popover: {
        title: CLIENT_ONBOARDING_TOUR_COPY.nextShoot.title,
        description: CLIENT_ONBOARDING_TOUR_COPY.nextShoot.body,
        side: "bottom",
        align: "start",
      },
    },
  ];
}

/** Five steps. The sidebar is on screen at >= lg, so the nav links are real. */
export function buildDesktopSteps(): DriveStep[] {
  return [
    ...dashboardSteps(),
    {
      element: ANCHORS.navReview,
      popover: {
        title: CLIENT_ONBOARDING_TOUR_COPY.review.title,
        description: CLIENT_ONBOARDING_TOUR_COPY.review.body,
        side: "right",
        align: "start",
      },
    },
    {
      element: ANCHORS.navFiles,
      popover: {
        title: CLIENT_ONBOARDING_TOUR_COPY.files.title,
        description: CLIENT_ONBOARDING_TOUR_COPY.files.body,
        side: "right",
        align: "start",
      },
    },
    {
      element: ANCHORS.navMessages,
      popover: {
        title: CLIENT_ONBOARDING_TOUR_COPY.messages.title,
        description: CLIENT_ONBOARDING_TOUR_COPY.messages.body,
        side: "right",
        align: "start",
      },
    },
  ];
}

/**
 * Three steps. The four nav links are off-screen below `lg`, so instead of
 * pointing at them the tour points at the one control that reveals them.
 */
export function buildMobileSteps(): DriveStep[] {
  return [
    ...dashboardSteps(),
    {
      element: ANCHORS.mobileMenu,
      popover: {
        title: CLIENT_ONBOARDING_TOUR_COPY.mobileMenu.title,
        description: CLIENT_ONBOARDING_TOUR_COPY.mobileMenu.body,
        side: "bottom",
        align: "start",
      },
    },
  ];
}
