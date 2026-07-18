"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Touch-primary detection. `(pointer: coarse)` describes the *input device*,
 * not the window size — a 375px-wide desktop browser stays fine-pointer, and
 * a tablet stays coarse when rotated to a wide viewport. That's the property
 * we actually want for keyboard/tap behaviour, so this deliberately does not
 * key off a width breakpoint the way the `lg:` CSS classes do.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Returns a ref that tracks whether the primary input is coarse (touch).
 *
 * A **ref, not state**, on purpose: reading this during render would make the
 * server (always false) and the first client render disagree, producing either
 * a hydration mismatch or a visible flash once the effect commits. Keeping it
 * out of the render path means SSR output is unconditional — callers branch at
 * *event time* (`ref.current`), where the value is guaranteed settled because
 * any interaction necessarily follows mount.
 *
 * Corollary: this hook cannot drive rendered output. Anything visual that must
 * differ by pointer type belongs in CSS (see the composer hint in
 * `MessageThread`, which renders both strings and swaps them with `lg:`).
 *
 * The `change` subscription matters for hybrids — a tablet gaining or losing a
 * keyboard/trackpad flips the media query without a reload.
 */
export function useCoarsePointer(): RefObject<boolean> {
  const isCoarseRef = useRef(false);

  useEffect(() => {
    // Guarded for SSR and for the jsdom-style environments that stub `window`
    // without `matchMedia`; the false default is the correct fallback either
    // way (fine pointer = today's behaviour).
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(COARSE_POINTER_QUERY);
    isCoarseRef.current = mql.matches;

    const onChange = (event: MediaQueryListEvent) => {
      isCoarseRef.current = event.matches;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isCoarseRef;
}
