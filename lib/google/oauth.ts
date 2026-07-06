// Auth types come from googleapis' re-exported namespace, NOT from
// google-auth-library directly — googleapis-common nests its own copy of
// that package and the two OAuth2Client declarations are not assignable.
import { google, type Auth } from "googleapis";
import { resolveBaseUrl } from "@/lib/baseUrl";

/**
 * Google OAuth for the calendar sync. One grant, Kelsey's personal Gmail.
 *
 * Stage 1 asks for calendar.readonly only; Stage 3 (portal → Google writes)
 * widens this to the full calendar scope, which will require a re-consent
 * (Disconnect → Connect) because the stored refresh token is scope-bound.
 *
 * The consent screen must be published to PRODUCTION (not Testing) — Google
 * expires an unverified Testing app's refresh tokens after 7 days, which
 * would silently kill the sync weekly.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

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
