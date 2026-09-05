"use client";

import { useEffect } from "react";
import { driver, type Driver } from "driver.js";
import type { TourOutcome } from "@/lib/tours";
import { recordClientOnboardingTourAction } from "../_actions";
import {
  buildDesktopSteps,
  buildMobileSteps,
  CLIENT_ONBOARDING_TOUR_COPY,
  DESKTOP_MEDIA_QUERY,
} from "./clientOnboardingTourSteps";
// Order matters only as documentation: every rule in the second file is
// scoped under `.dbs-tour-popover`, which outranks driver.css's own
// single-class rules on specificity alone.
import "driver.js/dist/driver.css";
import "./clientOnboardingTour.css";

const POPOVER_CLASS = "dbs-tour-popover";

interface ClientOnboardingTourProps {
  /**
   * Computed on the SERVER, in the dashboard page, after
   * `requireCurrentClient()` has already succeeded — never in an effect here.
   *
   * That ordering is the point. A client can reach /client/dashboard before
   * the Clerk webhook links their `clients` row; `requireCurrentClient()`
   * then throws and `app/client/error.tsx` renders inside the layout shell.
   * Because the gate is downstream of that await, this component is never
   * rendered on that path — so the tour can never fire over the error
   * boundary, spotlighting a phase tracker that isn't on screen.
   */
  show: boolean;
}

/**
 * Client onboarding tour (Tour 1). Renders nothing; drives driver.js.
 */
export function ClientOnboardingTour({ show }: ClientOnboardingTourProps) {
  useEffect(() => {
    if (!show) return;

    // Read once, here, rather than during render: the server has no viewport
    // and any breakpoint branch taken during render is a hydration mismatch.
    // Read once rather than on a resize listener too — the step set is fixed
    // when the tour starts, and a device rotated mid-tour is an accepted edge
    // on something that lasts under a minute.
    const isDesktop = window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
    const steps = isDesktop ? buildDesktopSteps() : buildMobileSteps();

    // Latches the first of the two exits. Both of them await a server round
    // trip before tearing the overlay down, and the popover stays clickable
    // for that whole window.
    let ending = false;

    function endTour(outcome: TourOutcome, instance: Driver) {
      if (ending) return;
      ending = true;

      // Deliberately awaited BEFORE destroy(). The overlay is what keeps the
      // page inert; dropping it first would let the client click into the
      // sidebar and navigate away mid-flight, cancelling the write and
      // re-firing the tour on their next visit.
      void (async () => {
        try {
          const result = await recordClientOnboardingTourAction(outcome);
          if (!result.ok) {
            console.error("[ClientOnboardingTour] not recorded:", result.error);
          }
        } catch (err) {
          console.error("[ClientOnboardingTour] not recorded:", err);
        } finally {
          // In a finally so a failed write still closes the tour. The cost of
          // a lost write is that the tour runs once more; the cost of a stuck
          // overlay is a portal the client cannot use at all.
          instance.destroy();
        }
      })();
    }

    const tour = driver({
      steps,

      // Squares off the spotlight. globals.css's `* { border-radius: 0 }`
      // cannot reach this — the cutout is an SVG path, not a CSS box — so
      // this config value is the only thing standing between the design
      // system and a rounded rectangle.
      stageRadius: 0,

      // Zero so the sidebar-link steps' spotlight box sits flush against
      // the anchor — clientOnboardingTour.css's `outline-offset: -1px` on
      // `.driver-active-element` depends on that gap being zero. The two
      // dashboard-card steps (clientOnboardingTourSteps.ts) don't need the
      // outline trick — they already carry their own border — so they swap
      // in driver.js's own default padding for their own lifetime instead.
      stagePadding: 0,

      // Four of the five desktop steps highlight a link. Without this, a
      // client who clicks the thing being pointed at navigates away, the
      // tour dies with no row written, and it re-fires on their next visit.
      disableActiveInteraction: true,

      // A missing anchor drops its step instead of parking an orphan popover
      // in the middle of the screen attached to driver.js's dummy element.
      skipMissingElement: true,

      overlayColor: "var(--sidebar-bg)",
      popoverClass: POPOVER_CLASS,

      nextBtnText: CLIENT_ONBOARDING_TOUR_COPY.buttons.next,
      prevBtnText: CLIENT_ONBOARDING_TOUR_COPY.buttons.back,
      doneBtnText: CLIENT_ONBOARDING_TOUR_COPY.buttons.done,

      // ── Exactly two ways out, and both of them write a row ──────────────
      //
      // `allowClose` reads like the switch that would forbid the accidental
      // exits, and it is not: in driver.js 1.8.0 the close button is only
      // added to a step's button list when `allowClose` is true
      // (`[..., ...allowClose ? ["close"] : []]`), so turning it off deletes
      // the "Skip tour" button along with the escape hatches. The two
      // settings below suppress the accidental exits while keeping it.
      allowClose: true,
      // Escape would otherwise destroy the tour without writing anything.
      // Also disables arrow-key stepping; Tab still cycles the popover,
      // which driver.js traps independently of this flag.
      allowKeyboardControl: false,
      // A function here is dispatched instead of the built-in close, so a
      // stray click on the scrim does nothing at all.
      overlayClickBehavior: () => {},

      onDoneClick: (_element, _step, { driver: instance }) => {
        endTour("completed", instance);
      },
      onCloseClick: (_element, _step, { driver: instance }) => {
        endTour("skipped", instance);
      },

      onPopoverRender: (popover) => {
        // driver.js hardcodes `&times;` and an aria-label of "Close". This is
        // the tour's only visible exit, so it says what it does.
        popover.closeButton.textContent =
          CLIENT_ONBOARDING_TOUR_COPY.buttons.skip;
        popover.closeButton.setAttribute(
          "aria-label",
          CLIENT_ONBOARDING_TOUR_COPY.buttons.skip
        );
      },
    });

    tour.drive();

    // Tears the overlay down if the client navigates away mid-tour, and on
    // StrictMode's throwaway first mount in development. Writes nothing —
    // see the long note in `_actions.ts` for why that is not an oversight.
    return () => {
      tour.destroy();
    };
  }, [show]);

  return null;
}
