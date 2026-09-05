/**
 * Guided tours — shared identifiers.
 *
 * Deliberately dependency-free and directive-free so both halves of the
 * feature can import it: the server-side gate query and the server action
 * that writes the completion row. Nothing here is sent to the browser —
 * the tour component never names a tour key or a version, because the
 * action hardcodes both (see `_actions.ts` for why that matters).
 *
 * Backed by migration 021_tour_completions.sql. The values below must stay
 * inside that table's CHECK constraints:
 *   tour_key in ('client_onboarding', 'content_approval')
 *   outcome  in ('completed', 'skipped')
 *   version  > 0
 */

export type TourKey = "client_onboarding" | "content_approval";

/**
 * How a tour ended. Both values close the tour and both suppress a re-fire —
 * the gate tests for the ROW, never for this column — but they are different
 * answers to "have I actually onboarded this client?": 'completed' means they
 * read the whole thing, 'skipped' means they dismissed it having seen almost
 * nothing.
 */
export type TourOutcome = "completed" | "skipped";

export const CLIENT_ONBOARDING_TOUR_KEY: TourKey = "client_onboarding";

/**
 * Which BUILD of the client onboarding tour this is. Carried in the table's
 * UNIQUE (clerk_user_id, tour_key, version), so bumping this makes every
 * existing row miss the gate's equality test and the reworked tour re-fires
 * for everyone — without deleting anyone's history. Bump it only when the
 * tour changes enough that a client who already saw it should see it again.
 */
export const CLIENT_ONBOARDING_TOUR_VERSION = 1;
