"use server";

import { requireCurrentClient } from "@/lib/currentClient";
import { getSupabaseServiceClient } from "@/lib/supabase";
import {
  CLIENT_ONBOARDING_TOUR_KEY,
  CLIENT_ONBOARDING_TOUR_VERSION,
  type TourOutcome,
} from "@/lib/tours";
import type { ActionResult } from "@/lib/actions";

const VALID_OUTCOMES: readonly TourOutcome[] = ["completed", "skipped"];

/**
 * Record that the signed-in client has finished with the onboarding tour.
 *
 * ONLY `outcome` crosses the wire. `tour_key` and `version` are pinned here
 * on the server, so a client cannot post a forged version number and mark
 * themselves done with a build of the tour that does not exist yet — which
 * would suppress the real tour forever.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS CALLED FROM EXACTLY TWO PLACES, AND THAT IS LOAD-BEARING.
 * `ClientOnboardingTour.tsx` calls it from driver.js's `onDoneClick` and
 * `onCloseClick` — two real user gestures — and from NOWHERE ELSE.
 *
 * It must never be moved into driver.js's `onDestroyed` hook, however much
 * that looks like the one true exit point. `next.config.ts` sets
 * `reactStrictMode: true`, so in development React mounts every effect,
 * tears it down, and mounts it again. The tour effect's cleanup calls
 * `driver.destroy()`, `destroy()` fires `onDestroyed`, and a write sited
 * there would stamp a `skipped` row the instant the dashboard first painted
 * — before the client had seen a single step, and permanently, because the
 * gate only tests for the row's existence. The tour would then never appear
 * again for that person, in dev or anywhere else.
 *
 * The two-gesture wiring also gives the behaviour migration 021 describes:
 * a client who closes the tab mid-tour writes NO ROW and is still un-toured
 * next visit.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function recordClientOnboardingTourAction(
  outcome: TourOutcome
): Promise<ActionResult> {
  if (!VALID_OUTCOMES.includes(outcome)) {
    return { ok: false, error: "Invalid tour outcome" };
  }

  let client;
  try {
    client = await requireCurrentClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Not signed in",
    };
  }

  // Non-null in practice — the row was located BY this column — but the
  // column is nullable in the schema (a client exists before their Clerk
  // webhook lands), and `tour_completions.clerk_user_id` is NOT NULL.
  const clerkUserId = client.clerk_user_id;
  if (!clerkUserId) {
    return { ok: false, error: "No Clerk user linked to this client" };
  }

  const supabase = getSupabaseServiceClient();
  // upsert + ignoreDuplicates rather than insert: the table's UNIQUE on
  // (clerk_user_id, tour_key, version) is what makes the tour fire once, and
  // a client with the dashboard open in two tabs can genuinely finish twice.
  // The first row is the record; the second attempt should be a quiet no-op,
  // not a 409 surfaced to someone who did nothing wrong.
  const { error } = await supabase
    .from("tour_completions")
    .upsert(
      {
        clerk_user_id: clerkUserId,
        tour_key: CLIENT_ONBOARDING_TOUR_KEY,
        version: CLIENT_ONBOARDING_TOUR_VERSION,
        outcome,
      },
      {
        onConflict: "clerk_user_id,tour_key,version",
        ignoreDuplicates: true,
      }
    );
  if (error) return { ok: false, error: error.message };

  // No revalidatePath: nothing currently rendered depends on this row. The
  // dashboard is `force-dynamic`, so the gate re-reads it on the next visit.
  return { ok: true };
}
