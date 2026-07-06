import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import {
  buildGoogleAuthUrl,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * Kicks off the Google OAuth flow. Owner-only, session-carrying (listed in
 * middleware's isProtectedRoute) — this is a browser navigation from the
 * settings page, not a webhook.
 *
 * CSRF: a random `state` goes both into the auth URL and an httpOnly cookie;
 * the callback accepts the code only when the two match, so an attacker
 * can't complete the flow with a code bound to THEIR Google account and
 * silently swap the connected calendar.
 */
export async function GET() {
  const denied = await requireOwnerApi();
  if (denied) return denied;

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state));
  res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax so the cookie rides along on Google's top-level redirect back.
    sameSite: "lax",
    path: "/api/google",
    maxAge: 60 * 10,
  });
  return res;
}
