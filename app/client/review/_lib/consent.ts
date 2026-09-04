import type { RoundBilling } from "@/lib/revisionBilling";

/**
 * Consent — what the client was shown, carried with the send, and the rule
 * that binds the commit to it. Pure; both the dialog (client component) and
 * the submit action import it.
 *
 * THE PROBLEM THIS SOLVES (found 2026-09-04, refuse rule approved the same
 * day). The dialog and the commit read the same cycle row and the same opener
 * set through the same functions, so at any one instant they agree. Across
 * time they can disagree: between the client's page load and their press of
 * Send, Kelsey can raise the price, lower the included rounds, or flip the
 * billing mode, and the commit would then compute a charge the client was
 * never shown. The dialog's outcome therefore travels with the submission as
 * `ChangeRequestConsent`, and `consentMatches` is the one rule the commit
 * applies before it writes:
 *
 *   - A FREE outcome is accepted under any consent. Free is not a charge and
 *     cannot be disputed; a concurrent opener or a price turned off between
 *     the dialog and the commit only ever makes the send cheaper.
 *   - A CHARGE is written only when the consent is a charge of exactly that
 *     amount. Anything else refuses with nothing written, logs the mismatch
 *     server-side, and the client sees SEND_FAILED_TERMS_CHANGED: refresh,
 *     read the current terms, send again.
 *
 * So the amount on the row is always the amount the dialog showed, or there
 * is no amount at all — structurally, not by timing.
 */

/** What the dialog showed: no charge, or a charge of this exact amount. */
export type ChangeRequestConsent =
  | { kind: "none" }
  | { kind: "charge"; amount: number };

/** The consent the dialog carries for a given billing state. */
export function consentFor(billing: RoundBilling): ChangeRequestConsent {
  return billing.kind === "charge"
    ? { kind: "charge", amount: billing.price }
    : { kind: "none" };
}

/**
 * THE REFUSE RULE. True when the commit may proceed with `computed`; false
 * when it must refuse. See the module header for the two clauses.
 */
export function consentMatches(
  consent: ChangeRequestConsent,
  computed: RoundBilling
): boolean {
  if (computed.kind !== "charge") return true;
  return consent.kind === "charge" && consent.amount === computed.price;
}

/**
 * Shape check for the consent the client sends. The action maps a malformed
 * consent to an ordinary send failure; a well-formed one goes through the
 * refuse rule. `amount` must be a finite number above zero, mirroring the
 * CHECK on the round row.
 */
export function isValidConsent(value: unknown): value is ChangeRequestConsent {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "none") return true;
  if (kind !== "charge") return false;
  const amount = (value as { amount?: unknown }).amount;
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

/**
 * The developer-facing error the action returns on a refusal. The panel maps
 * exactly this value to SEND_FAILED_TERMS_CHANGED and every other failure to
 * SEND_FAILED. A constant rather than a prose message so the mapping is an
 * equality, not a substring match.
 */
export const TERMS_CHANGED_ERROR = "terms_changed";
