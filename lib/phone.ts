/**
 * Canonical phone handling shared by the Add/Edit client form, the create
 * action, and the clients PATCH route. Phone is stored as a bare 10-digit
 * string (see migration 004); formatPhone in
 * app/owner/clients/_lib/format.ts renders it as (XXX) XXX-XXXX.
 */
export interface NormalizedPhone {
  ok: boolean;
  /** Bare 10-digit string, or null when the input was empty. */
  value: string | null;
}

/**
 * Strip a phone input to its canonical 10-digit form. Accepts any punctuation
 * and an optional leading US country code "1". Empty/whitespace input is valid
 * and yields { ok: true, value: null } (no phone). Anything that doesn't
 * reduce to exactly 10 digits is { ok: false, value: null }.
 */
export function normalizePhone(
  raw: string | null | undefined
): NormalizedPhone {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { ok: true, value: null };
  const digits = trimmed.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return { ok: false, value: null };
  return { ok: true, value: ten };
}
