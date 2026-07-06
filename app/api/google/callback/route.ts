import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireOwnerApi } from "@/lib/auth";
import { resolveBaseUrl } from "@/lib/baseUrl";
import {
  exchangeCodeForTokens,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google/oauth";
import { saveGoogleConnection } from "@/lib/google/connection";
import { syncFromGoogle } from "@/lib/google/sync";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect target (registered on the GCP client as
 * https://portal.digitalbloomsocials.com/api/google/callback).
 *
 * Owner-only and session-carrying: Google redirects Kelsey's own browser
 * here, so her Clerk cookies are present and both the middleware backstop
 * and requireOwnerApi hold. Every exit redirects back to /owner/settings
 * with a ?google= flag the settings page turns into a banner.
 */
export async function GET(request: Request) {
  const denied = await requireOwnerApi();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;

  // User clicked "Cancel" on Google's consent screen.
  if (params.get("error")) {
    return redirectToSettings("denied");
  }

  const code = params.get("code");
  const state = params.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToSettings("state_mismatch");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Shouldn't happen with prompt=consent — but a connection row without
      // a refresh token would die as soon as the first access token expires.
      console.error("[google-callback] token exchange returned no refresh_token");
      return redirectToSettings("error");
    }

    await saveGoogleConnection({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? null,
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      granted_scopes: tokens.scope ?? null,
    });
  } catch (err) {
    console.error("[google-callback] OAuth exchange failed", err);
    return redirectToSettings("error");
  }

  // Initial import. Best-effort: the connection is already saved, and the
  // sync-on-view trigger / cron will retry, so a hiccup here shouldn't
  // surface as a failed connect.
  try {
    await syncFromGoogle();
  } catch (err) {
    console.error("[google-callback] initial sync failed", err);
  }

  return redirectToSettings("connected");
}

function redirectToSettings(flag: string): NextResponse {
  const res = NextResponse.redirect(
    `${resolveBaseUrl()}/owner/settings?google=${flag}`
  );
  // One-shot state — clear it whatever the outcome.
  res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 0,
  });
  return res;
}
