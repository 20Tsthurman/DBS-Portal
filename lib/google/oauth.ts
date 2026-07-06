// Auth types come from googleapis' re-exported namespace, NOT from
// google-auth-library directly — googleapis-common nests its own copy of
// that package and the two OAuth2Client declarations are not assignable.
import { google, type Auth } from "googleapis";
import { resolveBaseUrl } from "@/lib/baseUrl";

/**
 * Google OAuth for the calendar sync. One grant, Kelsey's personal Gmail.
 *
 * Stage 3 widened the scope from calendar.readonly to the full calendar
 * scope (portal → Google push). A grant made under the old scope is
 * detected via granted_scopes on the connection row and treated as
 * read-only until Kelsey reconnects — the refresh token is scope-bound.
 * The write scope must also be added on the GCP consent screen's Data
 * Access page.
 *
 * The consent screen must be published to PRODUCTION (not Testing) — Google
 * expires an unverified Testing app's refresh tokens after 7 days, which
 * would silently kill the sync weekly.
 */
export const GOOGLE_CALENDAR_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar";

export const GOOGLE_CALENDAR_SCOPES = [GOOGLE_CALENDAR_WRITE_SCOPE];

/**
 * Whether a stored grant can write to Google Calendar. Exact-token match on
 * the space-separated scope list — substring matching would false-positive
 * on "…/auth/calendar.readonly", which CONTAINS the write scope string.
 */
export function hasWriteScope(grantedScopes: string | null): boolean {
  return (grantedScopes ?? "")
    .split(/\s+/)
    .includes(GOOGLE_CALENDAR_WRITE_SCOPE);
}

/**
 * CSRF-state cookie shared by /api/google/connect and /api/google/callback.
 * Lives here (not in a route file) because Next.js route modules may only
 * export handler fields.
 */
export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Redirect URI registered on the GCP OAuth client. */
export function googleRedirectUri(): string {
  return `${resolveBaseUrl()}/api/google/callback`;
}

export function getGoogleOAuthClient(): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    googleRedirectUri()
  );
}

/**
 * Consent-screen URL. `access_type=offline` + `prompt=consent` together force
 * Google to issue a refresh token on EVERY connect — without `prompt=consent`
 * a re-connect after a disconnect returns no refresh token (Google only
 * issues one on the first grant) and the connection row would be unusable.
 */
export function buildGoogleAuthUrl(state: string): string {
  return getGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });
}

/** Exchange the callback `code` for tokens (refresh + access). */
export async function exchangeCodeForTokens(
  code: string
): Promise<Auth.Credentials> {
  const { tokens } = await getGoogleOAuthClient().getToken(code);
  return tokens;
}

/**
 * Best-effort revocation on disconnect. Failures are swallowed — the grant
 * also disappears when the row is cleared, and Kelsey can always revoke from
 * her Google account's third-party access page.
 */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await getGoogleOAuthClient().revokeToken(token);
  } catch (err) {
    console.error("[google-oauth] token revocation failed", err);
  }
}
